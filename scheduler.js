const schedule = require('node-schedule');
const db = require('./db');
const config = require('./config');
const { fetchBalance, fetchUsage, classifyError } = require('./services/deepseek');
const {
  saveGlobalSnapshot, saveProjectSnapshot, saveUsageSnapshot,
  calculateRate, deriveDailySpendFromSnapshots
} = require('./services/snapshot');
const { addAlert, hasRecent } = require('./services/alert');
const { sendPushToUser } = require('./services/push');

/** 告警触发时顺带推送锁屏通知（fire-and-forget） */
function notifyPush(userId, title, body) {
  if (userId == null) return;
  sendPushToUser(userId, { title, body, url: '/#alerts' }).catch(() => {});
}

let running = false;
let pendingRequest = false;
let job = null;
let lastUsageFetch = 0;

/**
 * 拉取全部启用密钥的余额，返回「用户 → 账号全局余额」映射。
 * 每个用户的账号全局余额优先取该用户默认密钥的余额，否则取首个成功值。
 * @param {Array<{id:number,user_id:number,api_key:string,is_default:number}>} projects
 * @returns {Promise<Map<number, number>>}
 */
async function pollBalances(projects) {
  const userBalances = new Map();

  for (const p of projects) {
    try {
      const data = await fetchBalance(p.api_key);
      if (data) {
        db.prepare(`
          UPDATE projects SET last_balance = ?, last_fetched_at = datetime('now'), last_error = NULL
          WHERE id = ?
        `).run(data.balance, p.id);
        saveProjectSnapshot(p.id, data.balance);
        console.log(`[Scheduler] ${p.name} 余额拉取成功: ¥${data.balance}`);
        if (p.user_id != null) {
          if (p.is_default || !userBalances.has(p.user_id)) {
            userBalances.set(p.user_id, data.balance);
          }
        }
      } else {
        db.prepare(`UPDATE projects SET last_error = ?, last_fetched_at = datetime('now') WHERE id = ?`)
          .run('余额拉取失败，请检查 Key 是否有效或网络是否可达', p.id);
      }
    } catch (err) {
      const info = classifyError(err);
      db.prepare(`UPDATE projects SET last_error = ?, last_fetched_at = datetime('now') WHERE id = ?`)
        .run(info.message.slice(0, 200), p.id);
      console.error(`[Scheduler] ${p.name} 拉取异常:`, info.message);
    }
  }

  return userBalances;
}

/** 触发各类低余额 / 消耗过快告警（按用户隔离） */
function checkAlerts(projects, userBalances) {
  // 全局低余额（账号维度，每用户）
  for (const [uid, balance] of userBalances) {
    if (balance < config.globalBalanceThreshold) {
      if (!hasRecent(uid, 0, 'global_low_balance', 24)) {
        addAlert(uid, 0, 'global_low_balance',
          `【账号全局】余额 ¥${balance.toFixed(2)} 低于阈值 ¥${config.globalBalanceThreshold.toFixed(2)}`);
        console.log(`[Alert] 用户 ${uid} 全局余额告警: ¥${balance.toFixed(2)} < ¥${config.globalBalanceThreshold.toFixed(2)}`);
        notifyPush(uid, '🚨 账号余额不足', `当前余额 ¥${balance.toFixed(2)}，请及时充值`);
      }
    }
  }

  // 每密钥独立阈值
  for (const p of projects) {
    if (p.last_balance == null) continue;
    if (p.last_balance < (p.balance_threshold ?? config.defaults.balanceThreshold)) {
      if (!hasRecent(p.user_id, p.id, 'key_low_balance', 24)) {
        addAlert(p.user_id, p.id, 'key_low_balance',
          `【${p.name}】余额 ¥${p.last_balance.toFixed(2)} 低于独立阈值 ¥${(p.balance_threshold ?? config.defaults.balanceThreshold).toFixed(2)}`);
        console.log(`[Alert] ${p.name} 低余额告警: ¥${p.last_balance.toFixed(2)} < ¥${p.balance_threshold}`);
        notifyPush(p.user_id, '🚨 余额不足', `【${p.name}】余额 ¥${p.last_balance.toFixed(2)} 低于阈值`);
      }
    }

    // 消耗过快（日耗速率）
    const rate = calculateRate(p.id);
    if (rate > 0 && rate > p.rate_threshold && !hasRecent(p.user_id, p.id, 'high_rate', 24)) {
      addAlert(p.user_id, p.id, 'high_rate',
        `【${p.name}】估算日消耗 ¥${rate.toFixed(2)} 超过阈值 ¥${p.rate_threshold.toFixed(2)}`);
      notifyPush(p.user_id, '⚡ 消耗过快', `【${p.name}】估算日消耗 ¥${rate.toFixed(2)} 超过阈值`);
    }
  }
}

/** 刷新用量数据：优先拉取配置的用量接口，否则用余额快照推导（均按用户隔离） */
async function refreshUsage(projects) {
  try {
    const byUser = new Map();
    for (const p of projects) {
      if (p.user_id == null) continue;
      if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
      byUser.get(p.user_id).push(p);
    }

    if (config.deepseekUsageEndpoint) {
      for (const [uid, userProjects] of byUser) {
        const seed = userProjects.find(p => p.is_default) || userProjects[0];
        if (!seed) continue;
        const rows = await fetchUsage(seed.api_key, Math.max(30, config.snapshotRetentionDays));
        if (rows && rows.length) {
          for (const r of rows) saveUsageSnapshot(uid, r.date, r.model, r.requests, r.tokens, r.cost, 'api');
          console.log(`[Usage] 用量接口刷新完成: ${rows.length} 条 (user ${uid})`);
        } else {
          console.log(`[Usage] 用量接口无数据返回 (user ${uid})`);
        }
      }
    }

    // 降级 / 补充：始终从余额快照推导每日消费
    for (const uid of byUser.keys()) {
      const derived = deriveDailySpendFromSnapshots(uid, config.snapshotRetentionDays);
      if (derived.length) console.log(`[Usage] 余额推导消费刷新完成: ${derived.length} 天 (user ${uid})`);
    }
  } catch (err) {
    console.error('[Usage] 用量刷新异常:', err.message);
  }
}

async function pollOnce() {
  const projects = db.prepare('SELECT * FROM projects WHERE enabled = 1 AND user_id IS NOT NULL').all();
  if (projects.length === 0) {
    console.log('[Scheduler] 无启用的密钥，跳过本轮');
    return;
  }

  const userBalances = await pollBalances(projects);

  // 每个用户各自保存账号全局快照（用于首页总余额 + 消费趋势推导）
  for (const [uid, balance] of userBalances) {
    saveGlobalSnapshot(uid, balance);
  }
  checkAlerts(projects, userBalances);

  // 用量刷新（间隔 USAGE_FETCH_INTERVAL_MIN）
  if (Date.now() - lastUsageFetch >= config.usageFetchIntervalMin * 60 * 1000) {
    lastUsageFetch = Date.now();
    await refreshUsage(projects);
  }
}

async function pollAll() {
  if (running) {
    // 上一轮未完成：标记待重跑，结束后自动补跑一次（保证“立即刷新”请求不丢失）
    console.log('[Scheduler] 上一轮未完成，标记待重跑');
    pendingRequest = true;
    return;
  }
  running = true;
  console.log(`[Scheduler] === 开始轮询 ${new Date().toISOString()} ===`);
  try {
    await pollOnce();
  } catch (err) {
    console.error('[Scheduler] 轮询异常:', err.message);
  } finally {
    running = false;
    console.log('[Scheduler] === 本轮结束 ===');
    if (pendingRequest) {
      pendingRequest = false;
      console.log('[Scheduler] 执行待重跑请求');
      pollAll();
    }
  }
}

/** 立即触发一次轮询（添加 / 编辑密钥后调用，让余额快速出现） */
function requestPoll() {
  pollAll();
}

function start() {
  if (job) return;
  const rule = new schedule.RecurrenceRule();
  rule.minute = new schedule.Range(0, 59, config.pollIntervalMin);
  job = schedule.scheduleJob(rule, pollAll);
  console.log(`[Scheduler] 定时任务已启动，间隔 ${config.pollIntervalMin} 分钟`);
  pollAll();
}

function stop() {
  if (job) { job.cancel(); job = null; console.log('[Scheduler] 已停止'); }
}

module.exports = { start, stop, requestPoll };

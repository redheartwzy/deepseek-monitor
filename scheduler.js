const schedule = require('node-schedule');
const db = require('./db');
const config = require('./config');
const { fetchBalance, fetchUsage, classifyError } = require('./services/deepseek');
const {
  saveGlobalSnapshot, saveProjectSnapshot, saveUsageSnapshot,
  calculateRate, deriveDailySpendFromSnapshots
} = require('./services/snapshot');
const { addAlert, hasRecent } = require('./services/alert');

let running = false;
let job = null;
let lastUsageFetch = 0;

/** 首次启动且设置了 DEEPSEEK_API_KEY 时，自动创建“默认密钥”项目 */
function seedDefaultKey() {
  if (!config.defaultApiKey) return;
  const count = db.prepare('SELECT COUNT(*) AS c FROM projects').get().c;
  if (count > 0) return;
  db.prepare(`
    INSERT INTO projects (name, api_key, balance_threshold, rate_threshold, is_default, enabled)
    VALUES ('默认密钥', ?, ?, ?, 1, 1)
  `).run(config.defaultApiKey, config.defaults.balanceThreshold, config.defaults.rateThreshold);
  console.log('[Scheduler] 已用 DEEPSEEK_API_KEY 自动创建“默认密钥”项目');
}

/** 拉取全部启用密钥的余额，返回首条成功余额（账号维度） */
async function pollBalances(projects) {
  let globalBalance = null;

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
        // 优先使用默认密钥的余额作为账号全局余额
        if (p.is_default || globalBalance === null) globalBalance = data.balance;
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

  return globalBalance;
}

/** 触发各类低余额 / 消耗过快告警 */
function checkAlerts(projects, globalBalance) {
  const recent = new Set();

  // 全局低余额
  if (globalBalance !== null && globalBalance < config.globalBalanceThreshold) {
    if (!hasRecent(0, 'global_low_balance', 24)) {
      addAlert(0, 'global_low_balance',
        `【账号全局】余额 ¥${globalBalance.toFixed(2)} 低于阈值 ¥${config.globalBalanceThreshold.toFixed(2)}`);
      console.log(`[Alert] 全局余额告警: ¥${globalBalance.toFixed(2)} < ¥${config.globalBalanceThreshold.toFixed(2)}`);
    }
  }

  // 每密钥独立阈值
  for (const p of projects) {
    if (p.last_balance == null) continue;
    if (p.last_balance < (p.balance_threshold ?? config.defaults.balanceThreshold)) {
      const key = `${p.id}|key_low_balance`;
      if (!recent.has(key) && !hasRecent(p.id, 'key_low_balance', 24)) {
        recent.add(key);
        addAlert(p.id, 'key_low_balance',
          `【${p.name}】余额 ¥${p.last_balance.toFixed(2)} 低于独立阈值 ¥${(p.balance_threshold ?? config.defaults.balanceThreshold).toFixed(2)}`);
        console.log(`[Alert] ${p.name} 低余额告警: ¥${p.last_balance.toFixed(2)} < ¥${p.balance_threshold}`);
      }
    }

    // 消耗过快（日耗速率）
    const rate = calculateRate(p.id);
    if (rate > 0 && rate > p.rate_threshold && !hasRecent(p.id, 'high_rate', 24)) {
      addAlert(p.id, 'high_rate',
        `【${p.name}】估算日消耗 ¥${rate.toFixed(2)} 超过阈值 ¥${p.rate_threshold.toFixed(2)}`);
    }
  }
}

/** 刷新用量数据：优先拉取配置的用量接口，否则用余额快照推导 */
async function refreshUsage(projects) {
  try {
    if (config.deepseekUsageEndpoint) {
      const seed = projects.find(p => p.is_default) || projects[0];
      if (seed) {
        const rows = await fetchUsage(seed.api_key, Math.max(30, config.snapshotRetentionDays));
        if (rows && rows.length) {
          for (const r of rows) saveUsageSnapshot(r.date, r.model, r.requests, r.tokens, r.cost, 'api');
          console.log(`[Usage] 用量接口刷新完成: ${rows.length} 条`);
        } else {
          console.log('[Usage] 用量接口无数据返回');
        }
      }
    }
    // 降级 / 补充：始终从余额快照推导每日消费
    const derived = deriveDailySpendFromSnapshots(config.snapshotRetentionDays);
    if (derived.length) console.log(`[Usage] 余额推导消费刷新完成: ${derived.length} 天`);
  } catch (err) {
    console.error('[Usage] 用量刷新异常:', err.message);
  }
}

async function pollOnce() {
  seedDefaultKey();

  const projects = db.prepare('SELECT * FROM projects WHERE enabled = 1').all();
  if (projects.length === 0) {
    console.log('[Scheduler] 无启用的密钥，跳过本轮');
    return;
  }

  const globalBalance = await pollBalances(projects);
  if (globalBalance === null) {
    console.log('[Scheduler] 所有 API Key 均无法拉取余额，本轮跳过');
  } else {
    saveGlobalSnapshot(globalBalance);
    checkAlerts(projects, globalBalance);
  }

  // 用量刷新（间隔 USAGE_FETCH_INTERVAL_MIN）
  if (Date.now() - lastUsageFetch >= config.usageFetchIntervalMin * 60 * 1000) {
    lastUsageFetch = Date.now();
    await refreshUsage(projects);
  }
}

async function pollAll() {
  if (running) {
    console.log('[Scheduler] 上一轮未完成，跳过本轮');
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
  }
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

module.exports = { start, stop };

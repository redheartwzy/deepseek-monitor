const schedule = require('node-schedule');
const db = require('./db');
const config = require('./config');
const { fetchBalance } = require('./services/deepseek');
const {
  saveGlobalSnapshot, saveProjectSnapshot,
  calculateRate, getLatestGlobalBalance
} = require('./services/snapshot');
const { addAlert, getUnacknowledged } = require('./services/alert');

let running = false;
let job = null;

async function pollOnce() {
  const projects = db.prepare('SELECT * FROM projects WHERE enabled = 1').all();
  if (projects.length === 0) {
    console.log('[Scheduler] 无启用的项目，跳过轮询');
    return;
  }

  // 依次尝试各项目 API Key，直到成功拉取全局余额
  let globalBalance = null;
  for (const p of projects) {
    console.log(`[Global] 尝试使用 ${p.name} 的 API Key 拉取账号余额...`);
    const data = await fetchBalance(p.api_key);
    if (data) {
      globalBalance = data.balance;
      console.log(`[Global] 账号余额拉取成功: ¥${globalBalance}`);
      break;
    }
    console.log(`[Global] ${p.name} 密钥无效，尝试下一个`);
  }

  if (globalBalance === null) {
    console.log('[Global] 所有 API Key 均无法拉取余额，本轮跳过');
    return;
  }

  // 保存全局余额快照
  saveGlobalSnapshot(globalBalance);
  const existingAlerts = getUnacknowledged();

  // 核心告警：账号总余额低于阈值
  if (globalBalance < config.globalBalanceThreshold) {
    const exists = existingAlerts.some(a => a.type === 'global_low_balance');
    if (!exists) {
      addAlert(0, 'global_low_balance',
        `【账号全局】余额 ¥${globalBalance} 低于阈值 ¥${config.globalBalanceThreshold}`);
      console.log(`[Alert] 触发全局余额告警: ¥${globalBalance} < ¥${config.globalBalanceThreshold}`);
    }
  }

  // 各密钥消耗采集
  for (const p of projects) {
    try {
      saveProjectSnapshot(p.id, globalBalance);
      const rate = calculateRate(p.id);
      console.log(`[Project] ${p.name} 估算日消耗: ¥${rate}/天`);

      if (rate > 0 && rate > p.rate_threshold) {
        const exists = existingAlerts.some(
          a => a.project_id === p.id && a.type === 'high_rate'
        );
        if (!exists) {
          addAlert(p.id, 'high_rate',
            `【${p.name}】估算日消耗 ¥${rate} 超过阈值 ¥${p.rate_threshold}`);
        }
      }
    } catch (err) {
      console.error(`[Scheduler] 项目 ${p.name} 处理失败:`, err.message);
    }
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

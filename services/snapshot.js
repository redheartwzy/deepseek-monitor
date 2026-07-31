const db = require('../db');

// ===== 全局余额快照 =====

function saveGlobalSnapshot(balance) {
  try {
    return db.prepare('INSERT INTO global_snapshots (balance) VALUES (?)').run(balance);
  } catch (err) {
    console.error('[Snapshot] 保存全局快照失败:', err.message);
    return null;
  }
}

function getGlobalSnapshots(days = 7) {
  try {
    return db.prepare(`
      SELECT balance, fetched_at FROM global_snapshots
      WHERE fetched_at >= datetime('now', ?)
      ORDER BY fetched_at ASC
    `).all(`-${days} days`);
  } catch (err) {
    console.error('[Snapshot] 查询全局快照失败:', err.message);
    return [];
  }
}

function getLatestGlobalBalance() {
  try {
    // 无快照时返回 null（表示“尚未拉取”），避免把 ¥0.00 误当真实余额
    return db.prepare('SELECT balance FROM global_snapshots ORDER BY fetched_at DESC LIMIT 1').pluck().get() ?? null;
  } catch (err) {
    console.error('[Snapshot] 查询最新余额失败:', err.message);
    return null;
  }
}

// ===== 单项目消耗追踪 =====

function saveProjectSnapshot(projectId, balance) {
  try {
    return db.prepare('INSERT INTO snapshots (project_id, balance) VALUES (?, ?)').run(projectId, balance);
  } catch (err) {
    console.error('[Snapshot] 保存项目快照失败:', err.message);
    return null;
  }
}

function getProjectSnapshots(projectId, days = 7) {
  try {
    return db.prepare(`
      SELECT balance, fetched_at FROM snapshots
      WHERE project_id = ? AND fetched_at >= datetime('now', ?)
      ORDER BY fetched_at ASC
    `).all(projectId, `-${days} days`);
  } catch (err) {
    console.error('[Snapshot] 查询项目快照失败:', err.message);
    return [];
  }
}

function calculateRate(projectId, days = 7) {
  try {
    const rows = getProjectSnapshots(projectId, days);
    if (rows.length < 2) return 0;
    const t0 = new Date(rows[0].fetched_at).getTime();
    const t1 = new Date(rows[rows.length - 1].fetched_at).getTime();
    const elapsedDays = (t1 - t0) / (1000 * 60 * 60 * 24);
    if (elapsedDays < 0.001) return 0;
    const consumed = rows[0].balance - rows[rows.length - 1].balance;
    if (consumed < 0) return 0;
    return Math.round((consumed / elapsedDays) * 100) / 100;
  } catch (err) {
    console.error('[Snapshot] 计算速率失败:', err.message);
    return 0;
  }
}

// ===== 模块二：用量明细 =====

/**
 * 写入一条按 (date, model, source) 去重的用量行。
 * @param {string} date   YYYY-MM-DD
 * @param {string} model
 * @param {number|null} requests
 * @param {number|null} tokens
 * @param {number} cost
 * @param {'api'|'derived'} source
 */
function saveUsageSnapshot(date, model, requests, tokens, cost, source = 'api') {
  try {
    return db.prepare(`
      INSERT OR REPLACE INTO usage_snapshots (date, model, requests, tokens, cost, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(date, model, requests, tokens, cost, source);
  } catch (err) {
    console.error('[Snapshot] 保存用量失败:', err.message);
    return null;
  }
}

function getUsageSnapshots(days = 7) {
  try {
    return db.prepare(`
      SELECT * FROM usage_snapshots
      WHERE date >= date('now', ?)
      ORDER BY date ASC, model ASC
    `).all(`-${days + 1} days`);
  } catch (err) {
    console.error('[Snapshot] 查询用量失败:', err.message);
    return [];
  }
}

function getModelsFromUsage(days = 7) {
  try {
    return db.prepare(`
      SELECT DISTINCT model FROM usage_snapshots
      WHERE date >= date('now', ?)
      ORDER BY model ASC
    `).all(`-${days + 1} days`).map(r => r.model);
  } catch (err) {
    console.error('[Snapshot] 查询模型列表失败:', err.message);
    return [];
  }
}

/**
 * 从全局余额快照推导每日消费（DeepSeek 未公开用量接口时的降级方案）。
 * 每日消费 = 当日首个快照余额 - 当日末个快照余额（充值导致上升则记为 0）。
 * 结果直接写入 usage_snapshots（model='全部', source='derived', requests/tokens 为 null）。
 */
function deriveDailySpendFromSnapshots(days = 7) {
  try {
    const rows = getGlobalSnapshots(days);
    if (rows.length < 2) return [];

    const byDay = new Map();
    for (const r of rows) {
      const day = String(r.fetched_at).slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push({ balance: parseFloat(r.balance), ts: new Date(r.fetched_at).getTime() });
    }

    const out = [];
    for (const [day, snaps] of byDay) {
      snaps.sort((a, b) => a.ts - b.ts);
      const spend = Math.max(0, snaps[0].balance - snaps[snaps.length - 1].balance);
      if (spend > 0) {
        saveUsageSnapshot(day, '全部', null, null, Math.round(spend * 10000) / 10000, 'derived');
        out.push({ date: day, cost: Math.round(spend * 10000) / 10000 });
      }
    }
    return out;
  } catch (err) {
    console.error('[Snapshot] 推导每日消费失败:', err.message);
    return [];
  }
}

/**
 * 消费趋势摘要（用于邮件告警内容）。
 * @returns {{totalCost:number, avgDailyCost:number, dayCount:number}}
 */
function getConsumptionSummary(days = 7) {
  const derived = deriveDailySpendFromSnapshots(days);
  if (!derived.length) {
    // 无快照可推导时退化为用全部用量表（含 api 来源）
    const rows = getUsageSnapshots(days);
    const total = rows.reduce((s, r) => s + (r.cost || 0), 0);
    return { totalCost: Math.round(total * 100) / 100, avgDailyCost: 0, dayCount: 0 };
  }
  const totalCost = Math.round(derived.reduce((s, d) => s + d.cost, 0) * 100) / 100;
  return {
    totalCost,
    avgDailyCost: Math.round((totalCost / derived.length) * 100) / 100,
    dayCount: derived.length
  };
}

module.exports = {
  saveGlobalSnapshot, getGlobalSnapshots, getLatestGlobalBalance,
  saveProjectSnapshot, getProjectSnapshots, calculateRate,
  saveUsageSnapshot, getUsageSnapshots, getModelsFromUsage,
  deriveDailySpendFromSnapshots, getConsumptionSummary
};

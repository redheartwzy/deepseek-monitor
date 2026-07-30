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
    return db.prepare('SELECT balance FROM global_snapshots ORDER BY fetched_at DESC LIMIT 1').pluck().get() || 0;
  } catch (err) {
    console.error('[Snapshot] 查询最新余额失败:', err.message);
    return 0;
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

module.exports = {
  saveGlobalSnapshot, getGlobalSnapshots, getLatestGlobalBalance,
  saveProjectSnapshot, getProjectSnapshots, calculateRate
};

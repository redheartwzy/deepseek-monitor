const db = require('../db');

function addAlert(projectId, type, message) {
  try {
    const stmt = db.prepare(
      'INSERT INTO alerts (project_id, type, message) VALUES (?, ?, ?)'
    );
    return stmt.run(projectId, type, message);
  } catch (err) {
    console.error('[Alert] 写入告警失败:', err.message);
    return null;
  }
}

function getUnacknowledged() {
  try {
    return db.prepare(`
      SELECT a.*, p.name AS project_name FROM alerts a
      JOIN projects p ON p.id = a.project_id
      WHERE a.acknowledged = 0
      ORDER BY a.triggered_at DESC
    `).all();
  } catch (err) {
    console.error('[Alert] 查询告警失败:', err.message);
    return [];
  }
}

function acknowledge(id) {
  try {
    return db.prepare('UPDATE alerts SET acknowledged = 1 WHERE id = ?').run(id);
  } catch (err) {
    console.error('[Alert] 确认告警失败:', err.message);
    return null;
  }
}

/**
 * 判断最近 hours 小时内是否已有同类型告警（用于去重，避免每轮轮询重复插入）。
 * @param {number} projectId  全局告警用 0
 * @param {string} type
 * @param {number} hours
 */
function hasRecent(projectId, type, hours = 24) {
  try {
    const row = db.prepare(`
      SELECT id FROM alerts
      WHERE project_id = ? AND type = ? AND triggered_at >= datetime('now', ?)
      LIMIT 1
    `).get(projectId, type, `-${hours} hours`);
    return Boolean(row);
  } catch (err) {
    console.error('[Alert] 查询最近告警失败:', err.message);
    return false;
  }
}

module.exports = { addAlert, getUnacknowledged, acknowledge, hasRecent };

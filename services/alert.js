const db = require('../db');

function addAlert(userId, projectId, type, message) {
  try {
    return db.prepare(
      'INSERT INTO alerts (user_id, project_id, type, message) VALUES (?, ?, ?, ?)'
    ).run(userId, projectId, type, message);
  } catch (err) {
    console.error('[Alert] 写入告警失败:', err.message);
    return null;
  }
}

/** 当前用户的未确认告警（含项目告警与账号全局告警） */
function getUnacknowledged(userId) {
  try {
    return db.prepare(`
      SELECT a.id, a.project_id, a.type, a.message, a.triggered_at, a.acknowledged,
             COALESCE(p.name, '账号全局') AS project_name
      FROM alerts a
      LEFT JOIN projects p ON p.id = a.project_id
      WHERE a.acknowledged = 0 AND (
        a.user_id = ?
        OR a.project_id IN (SELECT id FROM projects WHERE user_id = ?)
      )
      ORDER BY a.triggered_at DESC
    `).all(userId, userId);
  } catch (err) {
    console.error('[Alert] 查询告警失败:', err.message);
    return [];
  }
}

function acknowledge(id, userId) {
  try {
    return db.prepare(`
      UPDATE alerts SET acknowledged = 1
      WHERE id = ? AND (
        user_id = ?
        OR project_id IN (SELECT id FROM projects WHERE user_id = ?)
      )
    `).run(id, userId, userId);
  } catch (err) {
    console.error('[Alert] 确认告警失败:', err.message);
    return null;
  }
}

/**
 * 判断最近 hours 小时内是否已有同类型告警（用于去重，避免每轮轮询重复插入）。
 * @param {number} userId   全局告警用 0
 * @param {number} projectId 全局告警用 0
 * @param {string} type
 * @param {number} hours
 */
function hasRecent(userId, projectId, type, hours = 24) {
  try {
    const row = db.prepare(`
      SELECT id FROM alerts
      WHERE user_id = ? AND project_id = ? AND type = ? AND triggered_at >= datetime('now', ?)
      LIMIT 1
    `).get(userId, projectId, type, `-${hours} hours`);
    return Boolean(row);
  } catch (err) {
    console.error('[Alert] 查询最近告警失败:', err.message);
    return false;
  }
}

module.exports = { addAlert, getUnacknowledged, acknowledge, hasRecent };

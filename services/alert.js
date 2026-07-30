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

module.exports = { addAlert, getUnacknowledged, acknowledge };

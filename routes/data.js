const express = require('express');
const router = express.Router();
const { getProjectSnapshots, getGlobalSnapshots, getLatestGlobalBalance } = require('../services/snapshot');
const { getUnacknowledged, acknowledge } = require('../services/alert');

router.get('/snapshots/:projectId', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    res.json({ code: 0, data: getProjectSnapshots(req.params.projectId, days) });
  } catch (err) {
    console.error('[Data] 查询快照失败:', err.message);
    res.status(500).json({ code: 1, message: '查询快照失败' });
  }
});

router.get('/global-balance', (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const balance = getLatestGlobalBalance();
    const history = getGlobalSnapshots(days);
    res.json({ code: 0, data: { balance, history } });
  } catch (err) {
    console.error('[Data] 查询全局余额失败:', err.message);
    res.status(500).json({ code: 1, message: '查询全局余额失败' });
  }
});

router.get('/alerts', (req, res) => {
  try {
    res.json({ code: 0, data: getUnacknowledged() });
  } catch (err) {
    console.error('[Data] 查询告警失败:', err.message);
    res.status(500).json({ code: 1, message: '查询告警失败' });
  }
});

router.put('/alerts/:id/ack', (req, res) => {
  try {
    const result = acknowledge(req.params.id);
    if (!result || !result.changes) {
      return res.status(404).json({ code: 1, message: '告警不存在' });
    }
    res.json({ code: 0, message: '已确认' });
  } catch (err) {
    console.error('[Data] 确认告警失败:', err.message);
    res.status(500).json({ code: 1, message: '确认告警失败' });
  }
});

module.exports = router;

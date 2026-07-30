const express = require('express');
const router = express.Router();
const db = require('../db');
const { calculateRate, getLatestGlobalBalance } = require('../services/snapshot');

router.get('/', (req, res) => {
  try {
    const globalBalance = getLatestGlobalBalance();
    const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
    const data = projects.map(p => ({
      ...p,
      global_balance: globalBalance,
      daily_rate: calculateRate(p.id)
    }));
    res.json({ code: 0, data });
  } catch (err) {
    console.error('[Projects] 查询失败:', err.message);
    res.status(500).json({ code: 1, message: '查询失败' });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, api_key, rate_threshold } = req.body;
    if (!name || !api_key) {
      return res.status(400).json({ code: 1, message: '名称和 API Key 不能为空' });
    }
    const result = db.prepare(
      'INSERT INTO projects (name, api_key, rate_threshold) VALUES (?, ?, ?)'
    ).run(name, api_key, rate_threshold ?? 5.0);
    res.json({ code: 0, data: { id: result.lastInsertRowid }, message: '创建成功' });
  } catch (err) {
    console.error('[Projects] 创建失败:', err.message);
    res.status(500).json({ code: 1, message: '创建失败' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { name, api_key, rate_threshold, enabled } = req.body;
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (api_key !== undefined) { fields.push('api_key = ?'); values.push(api_key); }
    if (rate_threshold !== undefined) { fields.push('rate_threshold = ?'); values.push(rate_threshold); }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
    if (!fields.length) {
      return res.status(400).json({ code: 1, message: '没有需要更新的字段' });
    }
    values.push(req.params.id);
    const result = db.prepare(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);
    if (!result.changes) {
      return res.status(404).json({ code: 1, message: '项目不存在' });
    }
    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    console.error('[Projects] 更新失败:', err.message);
    res.status(500).json({ code: 1, message: '更新失败' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    if (!result.changes) {
      return res.status(404).json({ code: 1, message: '项目不存在' });
    }
    res.json({ code: 0, message: '删除成功' });
  } catch (err) {
    console.error('[Projects] 删除失败:', err.message);
    res.status(500).json({ code: 1, message: '删除失败' });
  }
});

module.exports = router;

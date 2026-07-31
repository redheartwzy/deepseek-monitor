const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const { calculateRate, getLatestGlobalBalance } = require('../services/snapshot');

/** 掩码显示密钥，避免完整 Key 暴露给浏览器 */
function maskKey(key) {
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 3)}…${key.slice(-3)}`;
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

function serialize(rows) {
  return (rows || []).map(p => ({
    id: p.id,
    name: p.name,
    api_key_preview: maskKey(p.api_key),
    has_key: Boolean(p.api_key),
    balance_threshold: p.balance_threshold,
    rate_threshold: p.rate_threshold,
    enabled: Boolean(p.enabled),
    is_default: Boolean(p.is_default),
    last_balance: p.last_balance,
    last_fetched_at: p.last_fetched_at,
    last_error: p.last_error,
    created_at: p.created_at,
    daily_rate: calculateRate(p.id)
  }));
}

router.get('/', (req, res) => {
  try {
    const globalBalance = getLatestGlobalBalance();
    const projects = db.prepare('SELECT * FROM projects ORDER BY is_default DESC, created_at DESC').all();
    res.json({
      code: 0,
      data: { projects: serialize(projects), global_balance: globalBalance }
    });
  } catch (err) {
    console.error('[Projects] 查询失败:', err.message);
    res.status(500).json({ code: 1, message: '查询失败' });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, api_key, balance_threshold, rate_threshold, is_default } = req.body;
    if (!name || !api_key) {
      return res.status(400).json({ code: 1, message: '名称和 API Key 不能为空' });
    }
    const asDefault = is_default ? 1 : 0;
    const tx = db.transaction(() => {
      if (asDefault) db.prepare('UPDATE projects SET is_default = 0').run();
      const result = db.prepare(`
        INSERT INTO projects (name, api_key, balance_threshold, rate_threshold, is_default)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        name,
        api_key,
        balance_threshold ?? config.defaults.balanceThreshold,
        rate_threshold ?? config.defaults.rateThreshold,
        asDefault
      );
      return result.lastInsertRowid;
    });
    res.json({ code: 0, data: { id: tx() }, message: '创建成功' });
  } catch (err) {
    console.error('[Projects] 创建失败:', err.message);
    res.status(500).json({ code: 1, message: '创建失败' });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { name, api_key, balance_threshold, rate_threshold, enabled, is_default } = req.body;
    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (api_key !== undefined && api_key) { fields.push('api_key = ?'); values.push(api_key); }
    if (balance_threshold !== undefined) { fields.push('balance_threshold = ?'); values.push(balance_threshold); }
    if (rate_threshold !== undefined) { fields.push('rate_threshold = ?'); values.push(rate_threshold); }
    if (enabled !== undefined) { fields.push('enabled = ?'); values.push(enabled ? 1 : 0); }
    if (is_default !== undefined) { fields.push('is_default = ?'); values.push(is_default ? 1 : 0); }
    if (!fields.length) {
      return res.status(400).json({ code: 1, message: '没有需要更新的字段' });
    }

    const tx = db.transaction(() => {
      if (is_default) db.prepare('UPDATE projects SET is_default = 0').run();
      values.push(req.params.id);
      const result = db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return result.changes;
    });

    const changes = tx();
    if (!changes) return res.status(404).json({ code: 1, message: '项目不存在' });
    res.json({ code: 0, message: '更新成功' });
  } catch (err) {
    console.error('[Projects] 更新失败:', err.message);
    res.status(500).json({ code: 1, message: '更新失败' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const target = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    if (!target) return res.status(404).json({ code: 1, message: '项目不存在' });

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
      // 若删除的是默认密钥，自动推选最新一条为默认
      if (target.is_default) {
        const next = db.prepare('SELECT id FROM projects ORDER BY created_at DESC LIMIT 1').get();
        if (next) db.prepare('UPDATE projects SET is_default = 1 WHERE id = ?').run(next.id);
      }
    });
    tx();
    res.json({ code: 0, message: '删除成功' });
  } catch (err) {
    console.error('[Projects] 删除失败:', err.message);
    res.status(500).json({ code: 1, message: '删除失败' });
  }
});

module.exports = router;

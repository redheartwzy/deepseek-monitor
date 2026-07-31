const express = require('express');
const router = express.Router();
const { getProjectSnapshots, getGlobalSnapshots, getLatestGlobalBalance, getUsageSnapshots, getModelsFromUsage, deriveDailySpendFromSnapshots } = require('../services/snapshot');
const { getUnacknowledged, acknowledge } = require('../services/alert');

const round2 = n => Math.round(n * 100) / 100;

function summarize(daily, models) {
  const totalCost = round2(daily.reduce((s, d) => s + (d.cost || 0), 0));
  const anyReq = daily.some(d => d.requests != null);
  const anyTok = daily.some(d => d.tokens != null);
  return {
    daily,
    models,
    summary: {
      totalCost,
      totalRequests: anyReq ? daily.reduce((s, d) => s + (d.requests || 0), 0) : null,
      totalTokens: anyTok ? daily.reduce((s, d) => s + (d.tokens || 0), 0) : null
    }
  };
}

/**
 * 汇总用量数据。
 *  - source='derived'（余额快照推导）→ 权威的每日“全部”消费；
 *  - source='api'（DEEPSEEK_USAGE_ENDPOINT）→ 分模型明细，含 requests / tokens。
 * 指定 model 时仅返回该模型的 api 行；否则返回“全部”序列（优先派生值）。
 */
function buildUsage(days, modelFilter) {
  deriveDailySpendFromSnapshots(days); // 幂等 upsert，保证最新派生数据
  const rows = getUsageSnapshots(days);
  const models = ['全部', ...getModelsFromUsage(days).filter(m => m !== '全部')];

  const derivedMap = {};
  const apiByKey = {};
  for (const r of rows) {
    if (r.source === 'derived') derivedMap[r.date] = r;
    else apiByKey[`${r.date}|${r.model}`] = r;
  }

  if (modelFilter && modelFilter !== '全部') {
    const matched = Object.values(apiByKey).filter(r => r.model === modelFilter);
    const dates = [...new Set(matched.map(r => r.date))].sort();
    const daily = dates.map(d => {
      const items = matched.filter(r => r.date === d);
      return {
        date: d,
        cost: round2(items.reduce((s, r) => s + (r.cost || 0), 0)),
        requests: items.some(r => r.requests != null) ? items.reduce((s, r) => s + (r.requests || 0), 0) : null,
        tokens: items.some(r => r.tokens != null) ? items.reduce((s, r) => s + (r.tokens || 0), 0) : null
      };
    });
    return summarize(daily, models);
  }

  const apiDates = new Set(Object.keys(apiByKey).map(k => k.split('|')[0]));
  const dates = [...new Set([...Object.keys(derivedMap), ...apiDates])].sort();
  const daily = dates.map(d => {
    const derived = derivedMap[d];
    const apiAll = apiByKey[`${d}|全部`];
    const perModel = Object.values(apiByKey).filter(r => r.date === d && r.model !== '全部');
    let cost, requests = null, tokens = null;
    if (derived) {
      cost = derived.cost;
    } else if (apiAll) {
      cost = apiAll.cost;
      requests = apiAll.requests;
      tokens = apiAll.tokens;
    } else {
      cost = perModel.reduce((s, r) => s + (r.cost || 0), 0);
      if (perModel.some(r => r.requests != null)) requests = perModel.reduce((s, r) => s + (r.requests || 0), 0);
      if (perModel.some(r => r.tokens != null)) tokens = perModel.reduce((s, r) => s + (r.tokens || 0), 0);
    }
    return { date: d, cost: round2(cost), requests, tokens };
  });

  return summarize(daily, models);
}

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

// 模块二：用量汇总（支持时间维度 + 模型筛选）
router.get('/usage', (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 365);
    const model = req.query.model || '全部';
    res.json({ code: 0, data: buildUsage(days, model) });
  } catch (err) {
    console.error('[Data] 查询用量失败:', err.message);
    res.status(500).json({ code: 1, message: '查询用量失败' });
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

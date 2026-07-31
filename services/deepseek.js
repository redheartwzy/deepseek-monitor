const axios = require('axios');
const config = require('../config');

/**
 * 把 axios 错误归类为可展示的类型。
 * @returns {{kind:'network'|'unauthorized'|'rate_limit'|'server'|'unknown', status:number|null, message:string}}
 */
function classifyError(err) {
  if (!err || !err.response) {
    return { kind: 'network', status: null, message: `网络请求失败: ${err && err.message ? err.message : '无响应'}` };
  }
  const status = err.response.status;
  const body = JSON.stringify(err.response.data || '');
  if (status === 401 || status === 403) {
    return { kind: 'unauthorized', status, message: `API Key 无效 (${status}): ${body.slice(0, 120)}` };
  }
  if (status === 429) {
    return { kind: 'rate_limit', status, message: `请求被限流 (429): ${body.slice(0, 120)}` };
  }
  if (status >= 500) {
    return { kind: 'server', status, message: `DeepSeek 服务端错误 (${status}): ${body.slice(0, 120)}` };
  }
  return { kind: 'unknown', status, message: `DeepSeek API ${status}: ${body.slice(0, 120)}` };
}

/**
 * 查询单个密钥的余额。
 * 优先使用官方接口 /user/balance；若返回 404/405 且未自定义端点，
 * 自动降级到 OpenAI 兼容的 /dashboard/billing/credit_grants。
 * @returns {Promise<{balance:number, currency:string}|null>}
 */
async function fetchBalance(apiKey) {
  const base = config.deepseekBaseURL.replace(/\/$/, '');
  const endpoints = ['/user/balance', '/dashboard/billing/credit_grants'];
  let lastErr = null;

  for (const ep of endpoints) {
    try {
      const res = await axios.get(`${base}${ep}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 15000
      });
      return normalizeBalance(res.data);
    } catch (err) {
      lastErr = err;
      // 仅对 404/405（端点不存在）继续尝试下一个端点；其余错误直接返回
      if (err.response && (err.response.status === 404 || err.response.status === 405)) {
        console.log(`[DeepSeek] ${ep} 不存在，尝试兼容端点...`);
        continue;
      }
      console.error('[DeepSeek]', classifyError(err).message);
      return null;
    }
  }

  if (lastErr) console.error('[DeepSeek] 所有余额端点均失败:', classifyError(lastErr).message);
  return null;
}

function normalizeBalance(data) {
  if (!data) return null;
  // DeepSeek 官方格式: { balance_infos: [{ currency, total_balance, ... }] }
  if (Array.isArray(data.balance_infos) && data.balance_infos.length) {
    const cny = data.balance_infos.find(i => i.currency === 'CNY') || data.balance_infos[0];
    const balance = parseFloat(cny.total_balance != null ? cny.total_balance : cny.balance);
    if (!Number.isFinite(balance)) return null;
    return { balance, currency: cny.currency || 'CNY' };
  }
  // OpenAI 兼容格式: { total_available, currency } / { balance }
  const raw = data.total_available != null ? data.total_available : data.balance;
  const balance = parseFloat(raw);
  if (!Number.isFinite(balance)) return null;
  return { balance, currency: data.currency || 'CNY' };
}

/**
 * 拉取用量明细（模块二）。DeepSeek 官方无公开用量接口，故为“可配置适配函数”：
 *  - 配置了 DEEPSEEK_USAGE_ENDPOINT：请求该地址，归一化为行数组；
 *  - 未配置：返回 null，由 scheduler 降级为“余额快照推导消费”。
 *
 * 端点期望的响应格式（README 有详细说明）：
 *   { "data": [ { "date": "2026-07-25", "model": "deepseek-chat",
 *                 "requests": 12, "tokens_in": 3000, "tokens_out": 800, "cost": 0.12 } ] }
 * @param {string} apiKey
 * @param {number} days
 * @returns {Promise<Array<{date:string, model:string, requests:number|null, tokens:number|null, cost:number}>|null>}
 */
async function fetchUsage(apiKey, days = 7) {
  if (!config.deepseekUsageEndpoint) return null;
  try {
    const separator = config.deepseekUsageEndpoint.includes('?') ? '&' : '?';
    const res = await axios.get(`${config.deepseekUsageEndpoint}${separator}days=${days}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 20000
    });
    return normalizeUsage(res.data);
  } catch (err) {
    console.error('[Usage] 用量拉取失败:', classifyError(err).message);
    return null;
  }
}

/** 归一化任意用量响应 → 按 (date, model) 聚合后的行数组 */
function normalizeUsage(data) {
  let rows = [];
  if (data && Array.isArray(data.data)) rows = data.data;
  else if (Array.isArray(data)) rows = data;

  const agg = new Map();
  for (const raw of rows || []) {
    if (!raw || !raw.date) continue;
    const date = String(raw.date).slice(0, 10);
    const model = raw.model || '全部';
    const requests = raw.requests != null ? parseInt(raw.requests, 10) : null;
    // 兼容 OpenAI 风格 usage.total_tokens
    const tokens = raw.tokens != null
      ? parseInt(raw.tokens, 10)
      : (raw.usage && raw.usage.total_tokens != null ? parseInt(raw.usage.total_tokens, 10) : null);
    const cost = parseFloat(raw.cost != null ? raw.cost
      : (raw.total_cost != null ? raw.total_cost : 0));
    if (!Number.isFinite(cost)) continue;

    const key = `${date}|${model}`;
    if (!agg.has(key)) agg.set(key, { date, model, requests: 0, tokens: 0, cost: 0, hasReq: false, hasTok: false });
    const g = agg.get(key);
    g.cost += cost;
    if (requests != null) { g.requests += requests; g.hasReq = true; }
    if (tokens != null) { g.tokens += tokens; g.hasTok = true; }
  }

  return [...agg.values()].map(g => ({
    date: g.date,
    model: g.model,
    requests: g.hasReq ? g.requests : null,
    tokens: g.hasTok ? g.tokens : null,
    cost: Math.round(g.cost * 10000) / 10000
  }));
}

module.exports = { fetchBalance, fetchUsage, normalizeUsage, classifyError };

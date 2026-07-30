const axios = require('axios');
const config = require('../config');

async function fetchBalance(apiKey) {
  try {
    const res = await axios.get(`${config.deepseekBaseURL}/user/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000
    });
    const infos = res.data.balance_infos || [];
    const cny = infos.find(i => i.currency === 'CNY');
    if (cny) return { balance: parseFloat(cny.total_balance), currency: 'CNY' };
    return { balance: parseFloat(res.data.balance) || 0, currency: res.data.currency || 'CNY' };
  } catch (err) {
    const msg = err.response
      ? `DeepSeek API ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : `网络请求失败: ${err.message}`;
    console.error('[DeepSeek]', msg);
    return null;
  }
}

module.exports = { fetchBalance };

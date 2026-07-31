/**
 * 前端运行时配置（模块一）。
 * 默认值与后端 config.js 保持一致；页面加载后通过 GET /api/config 用服务端
 * 环境变量覆盖（不含任何密钥 / SMTP 口令）。
 */
const DEFAULTS = {
  deepseekApiBase: 'https://api.deepseek.com',
  deepseekBaseURL: 'https://api.deepseek.com',
  refreshIntervalMs: 60000,
  balanceThreshold: 5.0,
  emailEnabled: false,
  emailConfigured: false,
  usageConfigured: false,
  pushEnabled: false,
  vapidPublicKey: ''
};

let serverConfig = { ...DEFAULTS };

export function setConfig(c) {
  serverConfig = { ...DEFAULTS, ...(c || {}) };
}

export function getConfig() {
  return serverConfig;
}

/** 页面轮询间隔（毫秒） */
export function getRefreshInterval() {
  return serverConfig.refreshIntervalMs || 60000;
}

/** 全局余额告警阈值 */
export function getBalanceThreshold() {
  return serverConfig.balanceThreshold ?? 5.0;
}

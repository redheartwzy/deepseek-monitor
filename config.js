const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  // 轮询间隔，单位分钟，最低 3 分钟
  pollIntervalMin: parseInt(process.env.POLL_INTERVAL_MIN, 10) || 5,
  // DeepSeek API 地址
  deepseekBaseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  // 账号全局余额告警阈值（所有 Key 共享同一余额）
  globalBalanceThreshold: parseFloat(process.env.GLOBAL_BALANCE_THRESHOLD) || 10.0,
  // 默认预警阈值（单 Key 维度）
  defaults: {
    rateThreshold: parseFloat(process.env.DEFAULT_RATE_THRESHOLD) || 5.0
  },
  // 快照保留天数
  snapshotRetentionDays: parseInt(process.env.SNAPSHOT_RETENTION_DAYS, 10) || 90
};

// 强制最低间隔 3 分钟
if (config.pollIntervalMin < 3) config.pollIntervalMin = 3;

module.exports = config;

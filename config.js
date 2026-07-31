/**
 * DeepSeek Monitor 全局配置
 * 所有配置均可通过环境变量覆盖，兼容 Railway / Docker / 本地运行。
 * 本地开发时支持根目录 .env 文件（已 gitignore），已存在的环境变量优先。
 */

const fs = require('fs');
const path = require('path');
try {
  const envFile = path.join(__dirname, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && m[1] && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
} catch { /* .env 解析失败时忽略 */ }

const toFloat = (v, dflt) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
};
const toInt = (v, dflt) => {
  const n = parseInt(v, 10);
  return Number.isInteger(n) ? n : dflt;
};

const config = {
  // ===== 服务端口 =====
  port: toInt(process.env.PORT, 3000),

  // ===== 模块一：DeepSeek API 接入 =====
  // API 基础地址（余额、用量接口共用）
  deepseekBaseURL: process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com',
  // 默认种子密钥：首次启动时若数据库无任何密钥，将自动创建一个名为“默认密钥”的项目
  defaultApiKey: process.env.DEEPSEEK_API_KEY || '',
  // 可选用量明细接口（DeepSeek 官方未公开用量明细 API）。
  // 配置后 scheduler 会从该地址拉取 {date, model, requests, tokens, cost} 明细；
  // 未配置时自动降级为“从余额快照推导每日消费”。
  deepseekUsageEndpoint: process.env.DEEPSEEK_USAGE_ENDPOINT || '',
  // 用量数据刷新间隔（分钟）
  usageFetchIntervalMin: toInt(process.env.USAGE_FETCH_INTERVAL_MIN, 60),

  // ===== 轮询 =====
  // 后端轮询 DeepSeek 余额的间隔，单位分钟，最低 3 分钟
  pollIntervalMin: toInt(process.env.POLL_INTERVAL_MIN, 5),
  // 前端页面刷新数据的间隔（毫秒），供 GET /api/config 下发给浏览器
  refreshIntervalMs: toInt(process.env.REFRESH_INTERVAL, 60000),

  // ===== 登录系统 =====
  // Session 有效期（天），cookie 与数据库 sessions 表共用
  sessionDays: toInt(process.env.SESSION_DAYS, 7),

  // ===== 告警阈值 =====
  // 全局余额告警阈值（账号维度）。BALANCE_THRESHOLD 为新名字，GLOBAL_BALANCE_THRESHOLD 为旧名别名
  globalBalanceThreshold: toFloat(
    process.env.BALANCE_THRESHOLD || process.env.GLOBAL_BALANCE_THRESHOLD,
    5.0
  ),
  // 默认预警阈值（单 Key 维度，可被 projects.balance_threshold / rate_threshold 覆盖）
  defaults: {
    balanceThreshold: toFloat(process.env.DEFAULT_BALANCE_THRESHOLD, 5.0),
    rateThreshold: toFloat(process.env.DEFAULT_RATE_THRESHOLD, 5.0)
  },

  // ===== 模块八：邮件告警（Nodemailer）=====
  email: {
    enabled: String(process.env.EMAIL_ENABLED).toLowerCase() === 'true',
    host: process.env.SMTP_HOST || '',
    port: toInt(process.env.SMTP_PORT, 465),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || (process.env.SMTP_PORT || '465') === '465',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || '',
    recipient: process.env.EMAIL_RECIPIENT || '',
    subjectPrefix: process.env.EMAIL_SUBJECT_PREFIX || '[DeepSeek Monitor]',
    // 每小时整点 07 分发送（避开整点拥堵）
    cron: process.env.EMAIL_CRON || '7 * * * *'
  },

  // ===== 数据保留 =====
  snapshotRetentionDays: toInt(process.env.SNAPSHOT_RETENTION_DAYS, 90),

  // ===== Web Push（锁屏推送）=====
  vapid: {
    // VAPID 公钥 / 私钥：可用 `node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"` 生成
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:deepseek-monitor@localhost'
  }
};

// 是否启用 Web Push（公钥私钥都配置了才启用）
config.pushEnabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);

// 强制最低轮询间隔 3 分钟
if (config.pollIntervalMin < 3) config.pollIntervalMin = 3;

// 暴露给前端的“安全子集”（不含任何密钥 / SMTP 口令）
config.publicConfig = {
  deepseekBaseURL: config.deepseekBaseURL,
  refreshIntervalMs: config.refreshIntervalMs,
  balanceThreshold: config.globalBalanceThreshold,
  emailEnabled: config.email.enabled,
  emailConfigured: Boolean(
    config.email.enabled && config.email.host && config.email.user && config.email.pass
  ),
  usageConfigured: Boolean(config.deepseekUsageEndpoint),
  // Web Push 公钥与开关（公钥必须给前端用于订阅；私钥仅存服务端）
  pushEnabled: config.pushEnabled,
  vapidPublicKey: config.vapid.publicKey
};

module.exports = config;

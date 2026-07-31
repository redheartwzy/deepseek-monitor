/**
 * 模块八：邮件告警
 * 使用 Nodemailer + node-schedule，每小时检查所有启用密钥，
 * 余额低于独立阈值时向 EMAIL_RECIPIENT 发送告警邮件（24h 去重）。
 * 未配置 SMTP 时仅输出日志提示（README 提供 QQ 邮箱 / Ethereal 免费测试账户指引）。
 */
const schedule = require('node-schedule');
const db = require('../db');
const config = require('../config');
const { getConsumptionSummary } = require('./snapshot');

function isConfigured() {
  return Boolean(
    config.email.enabled &&
    config.email.host &&
    config.email.user &&
    config.email.pass &&
    config.email.recipient
  );
}

function createTransport() {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: { user: config.email.user, pass: config.email.pass }
  });
}

/**
 * 紧急程度：余额低于阈值 50% → critical，否则 warning。
 * @returns {{level:'critical'|'warning', label:string}}
 */
function urgencyLevel(balance, threshold) {
  if (!threshold) return { level: 'warning', label: '⚠️ 警告' };
  if (balance < threshold * 0.5) return { level: 'critical', label: '🔴 紧急' };
  return { level: 'warning', label: '⚠️ 警告' };
}

function buildHtml({ name, balance, threshold, summary }) {
  const u = urgencyLevel(balance, threshold);
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const pct = threshold ? Math.min(100, Math.round((balance / threshold) * 100)) : 0;
  return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,'Segoe UI',sans-serif;background:#f8fafc;padding:24px;color:#1e293b">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:24px;border:1px solid #e2e8f0">
  <h2 style="margin:0 0 4px;color:#dc2626">${u.label} 余额告警</h2>
  <p style="color:#64748b;font-size:13px;margin:0 0 20px">DeepSeek Monitor · ${ts}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:8px 0;color:#64748b">密钥别名</td><td style="padding:8px 0;font-weight:600">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">当前余额</td><td style="padding:8px 0;font-weight:700;color:#dc2626">¥${Number(balance).toFixed(2)}</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">告警阈值</td><td style="padding:8px 0">¥${Number(threshold).toFixed(2)}（已达 ${pct}%）</td></tr>
    <tr><td style="padding:8px 0;color:#64748b">近 ${summary.dayCount || 0} 天消费</td><td style="padding:8px 0">¥${Number(summary.totalCost || 0).toFixed(2)}（日均 ¥${Number(summary.avgDailyCost || 0).toFixed(2)}）</td></tr>
  </table>
  <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #f1f5f9;color:#64748b;font-size:13px">
    请及时前往 <a href="https://platform.deepseek.com/topup" style="color:#2563eb">DeepSeek 充值</a>，
    避免服务中断。若已充值，余额回升后告警将自动解除。
  </p>
</div></body></html>`;
}

function hasRecentEmail(projectId, type, hours = 24) {
  try {
    const row = db.prepare(`
      SELECT id FROM email_logs
      WHERE project_id = ? AND type = ? AND sent_at >= datetime('now', ?)
      LIMIT 1
    `).get(projectId, type, `-${hours} hours`);
    return Boolean(row);
  } catch (err) {
    console.error('[Email] 查询发送日志失败:', err.message);
    return false;
  }
}

function logEmail(projectId, type) {
  try {
    db.prepare('INSERT INTO email_logs (project_id, type) VALUES (?, ?)').run(projectId, type);
  } catch (err) {
    console.error('[Email] 写入发送日志失败:', err.message);
  }
}

async function sendLowBalanceEmail(p) {
  if (!isConfigured()) {
    console.warn(
      '[Email] SMTP 未配置，跳过邮件发送。' +
      '请设置 EMAIL_ENABLED=true 及 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_RECIPIENT。' +
      '免费测试可用 Ethereal (https://ethereal.email)，或使用 QQ 邮箱授权码。'
    );
    return false;
  }
  if (p.last_balance == null) return false;
  if (hasRecentEmail(p.id, 'low_balance', 24)) return false;

  const threshold = p.balance_threshold ?? config.defaults.balanceThreshold;
  const summary = getConsumptionSummary(7);
  const transporter = createTransport();
  const u = urgencyLevel(p.last_balance, threshold);

  try {
    await transporter.sendMail({
      from: config.email.from,
      to: config.email.recipient,
      subject: `${config.email.subjectPrefix} ${u.label} ${p.name} 余额 ¥${Number(p.last_balance).toFixed(2)}`,
      html: buildHtml({ name: p.name, balance: p.last_balance, threshold, summary })
    });
    logEmail(p.id, 'low_balance');
    console.log(`[Email] 已发送低余额邮件: ${p.name} ¥${Number(p.last_balance).toFixed(2)}`);
    return true;
  } catch (err) {
    console.error('[Email] 发送失败:', err.message);
    return false;
  }
}

/** 检查所有启用密钥，余额低于独立阈值则发邮件 */
async function runEmailCheck() {
  const projects = db.prepare('SELECT * FROM projects WHERE enabled = 1').all();
  let sent = 0;
  for (const p of projects) {
    if (await sendLowBalanceEmail(p)) sent++;
  }
  if (sent > 0) console.log(`[Email] 本轮共发送 ${sent} 封告警邮件`);
}

function startEmailScheduler() {
  if (!config.email.enabled) {
    console.log('[Email] EMAIL_ENABLED=false，邮件告警未启动');
    return;
  }
  if (!isConfigured()) {
    console.warn('[Email] EMAIL_ENABLED=true 但 SMTP 参数不完整，邮件告警未启动。' +
      '请配置 SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/EMAIL_RECIPIENT');
    return;
  }

  // 每小时执行一次（cron 表达式来自 EMAIL_CRON）
  const job = schedule.scheduleJob(config.email.cron, () => {
    runEmailCheck().catch(err => console.error('[Email] 定时检查异常:', err.message));
  });
  console.log(`[Email] 邮件告警已启动，cron=${config.email.cron}，收件人=${config.email.recipient}`);

  // 启动后立即做一次检查，尽早发现低余额
  setTimeout(() => runEmailCheck().catch(() => {}), 8000);
  return job;
}

module.exports = { isConfigured, sendLowBalanceEmail, runEmailCheck, startEmailScheduler, urgencyLevel };

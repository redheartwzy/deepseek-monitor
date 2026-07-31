/**
 * 发送一封测试邮件，验证 SMTP 配置是否可用。
 * 用法：node scripts/test-email.js [收件人邮箱]
 * 收件人缺省时取 node 环境变量 TEST_EMAIL_TO，否则取 EMAIL_RECIPIENT。
 */
const config = require('../config');
const nodemailer = require('nodemailer');

const to = process.argv[2] || process.env.TEST_EMAIL_TO || config.email.recipient;
if (!to) {
  console.error('请指定收件人：node scripts/test-email.js 收件人@example.com');
  process.exit(1);
}
if (!config.email.host || !config.email.user || !config.email.pass) {
  console.error('SMTP 未配置完整（需 SMTP_HOST / SMTP_USER / SMTP_PASS），请先配置 .env 或环境变量');
  process.exit(1);
}

const transport = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure,
  auth: { user: config.email.user, pass: config.email.pass }
});

transport.sendMail({
  from: config.email.from || config.email.user,
  to,
  subject: `${config.email.subjectPrefix} SMTP 配置成功测试`,
  html: '<p>这是一封测试邮件：DeepSeek Monitor 邮件告警的 SMTP 配置已生效 ✅</p>'
}).then(() => {
  console.log(`✅ 测试邮件已发送至 ${to}`);
  process.exit(0);
}).catch(err => {
  console.error('❌ 发送失败:', err.message);
  process.exit(1);
});

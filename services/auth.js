/**
 * 登录系统：密码哈希 + 用户 / Session 管理
 *  - 密码使用 Node 内置 crypto.scryptSync 加盐哈希（不引入额外依赖）
 *  - Session 为随机 token，存 sessions 表，通过 HttpOnly cookie 下发
 */
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

// ===== 密码哈希 =====

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const test = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return test.length === expected.length && crypto.timingSafeEqual(test, expected);
  } catch {
    return false;
  }
}

// ===== 用户 =====

function findUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/**
 * 创建用户。
 * @param {{username:string, password:string, display_name?:string, email?:string, personal_info?:string}} user
 */
function createUser({ username, password, display_name, email, personal_info }) {
  const name = String(username || '').trim();
  if (!name || name.length < 2) throw new Error('用户名至少 2 个字符');
  if (String(password || '').length < 6) throw new Error('密码至少 6 位');
  if (findUserByUsername(name)) throw new Error('用户名已被注册');

  const result = db.prepare(`
    INSERT INTO users (username, password_hash, display_name, personal_info, email)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    name,
    hashPassword(password),
    String(display_name || '').trim() || null,
    personal_info || null,
    String(email || '').trim() || null
  );

  // 首个用户注册时，收养历史遗留的“无主密钥”（旧版本数据），避免密钥丢失
  const orphan = db.prepare('SELECT COUNT(*) AS c FROM projects WHERE user_id IS NULL').get().c;
  if (orphan > 0) {
    db.prepare('UPDATE projects SET user_id = ? WHERE user_id IS NULL').run(result.lastInsertRowid);
    console.log(`[Auth] 首个用户收养 ${orphan} 个历史密钥`);
  }

  return getUserById(result.lastInsertRowid);
}

function updateLastLogin(id) {
  db.prepare('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?').run(id);
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

/** 修改密码（scrypt 重新哈希） */
function changePassword(userId, newPassword) {
  return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(newPassword), userId);
}

/** 注销该用户除当前 session 外的所有会话（改密码后让其他设备下线） */
function deleteOtherSessions(userId, keepToken) {
  if (!keepToken) return;
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken);
}

// ===== Session =====

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO sessions (user_id, token, expires_at)
    VALUES (?, ?, datetime('now', ?))
  `).run(userId, token, `+${config.sessionDays} days`);
  return token;
}

function getUserBySession(token) {
  if (!token) return null;
  return db.prepare(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `).get(token) || null;
}

function deleteSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/** 清理过期 Session（启动 / 登录时顺带执行，避免表无限膨胀） */
function cleanupSessions() {
  try {
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  } catch { /* ignore */ }
}

/** 从请求头解析指定 cookie */
function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

/** 要求登录的中间件：校验 cookie → 挂载 req.user 与 req.authToken */
function requireAuth(req, res, next) {
  const token = readCookie(req, 'dsm_session');
  const user = getUserBySession(token);
  if (!user) {
    return res.status(401).json({ code: 401, message: '未登录或登录已过期' });
  }
  req.user = user;
  req.authToken = token;
  next();
}

module.exports = {
  hashPassword, verifyPassword,
  findUserByUsername, getUserById, createUser, updateLastLogin, countUsers,
  changePassword, deleteOtherSessions,
  createSession, getUserBySession, deleteSession, cleanupSessions,
  readCookie, requireAuth
};

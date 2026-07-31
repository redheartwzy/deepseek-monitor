/**
 * 登录系统路由
 *  - 首次登录即注册：填写个人信息，API Key / 邮箱均为选填
 *  - 注册时若填写了 API Key，自动创建“默认密钥”项目并开始监控
 */
const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const auth = require('../services/auth');
const scheduler = require('../scheduler');

const SESSION_COOKIE = 'dsm_session';

function setSessionCookie(res, token) {
  const maxAge = config.sessionDays * 86400;
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    email: u.email || '',
    personal_info: u.personal_info ? JSON.parse(u.personal_info) : {},
    has_api: Boolean(db.prepare('SELECT 1 AS x FROM projects WHERE user_id = ? LIMIT 1').get(u.id)),
    created_at: u.created_at,
    last_login_at: u.last_login_at
  };
}

/** 是否存在账号（前端据此默认展示“注册”或“登录”Tab） */
router.get('/first', (req, res) => {
  res.json({ code: 0, data: { first: auth.countUsers() === 0 } });
});

/** 当前登录用户 */
router.get('/me', (req, res) => {
  const user = auth.getUserBySession(auth.readCookie(req, SESSION_COOKIE));
  if (!user) return res.status(401).json({ code: 401, message: '未登录' });
  res.json({ code: 0, data: publicUser(user) });
});

/** 注册（首次登录） */
router.post('/register', (req, res) => {
  try {
    const { username, password, display_name, email, api_key, personal_info } = req.body;
    if (!username || !password) {
      return res.status(400).json({ code: 1, message: '用户名和密码不能为空' });
    }
    const user = auth.createUser({
      username,
      password,
      display_name,
      email,
      personal_info: personal_info ? JSON.stringify(personal_info) : null
    });

    // API Key 为选填；填了就自动创建“默认密钥”项目，登录后立即可见
    if (api_key && String(api_key).trim()) {
      db.prepare(`
        INSERT INTO projects (name, api_key, balance_threshold, rate_threshold, is_default, user_id)
        VALUES (?, ?, ?, ?, 1, ?)
      `).run(
        '默认密钥',
        String(api_key).trim(),
        config.defaults.balanceThreshold,
        config.defaults.rateThreshold,
        user.id
      );
      // 立即拉取一次余额，注册完就能看到
      scheduler.requestPoll();
    }

    const token = auth.createSession(user.id);
    auth.updateLastLogin(user.id);
    setSessionCookie(res, token);
    res.json({ code: 0, data: publicUser(user), message: '注册成功' });
  } catch (err) {
    res.status(400).json({ code: 1, message: err.message });
  }
});

/** 登录 */
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    const user = auth.findUserByUsername(username);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ code: 1, message: '用户名或密码错误' });
    }
    auth.cleanupSessions();
    const token = auth.createSession(user.id);
    auth.updateLastLogin(user.id);
    setSessionCookie(res, token);
    res.json({ code: 0, data: publicUser(user), message: '登录成功' });
  } catch (err) {
    res.status(500).json({ code: 1, message: err.message });
  }
});

/** 退出登录 */
router.post('/logout', (req, res) => {
  auth.deleteSession(auth.readCookie(req, SESSION_COOKIE));
  clearSessionCookie(res);
  res.json({ code: 0, message: '已退出' });
});

/** 修改密码（校验当前密码；改后其他设备下线，当前会话保持） */
router.post('/change-password', auth.requireAuth, (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!auth.verifyPassword(current_password, req.user.password_hash)) {
      return res.status(401).json({ code: 1, message: '当前密码错误' });
    }
    if (String(new_password || '').length < 6) {
      return res.status(400).json({ code: 1, message: '新密码至少 6 位' });
    }
    auth.changePassword(req.user.id, new_password);
    auth.deleteOtherSessions(req.user.id, req.authToken);
    res.json({ code: 0, message: '密码已修改' });
  } catch (err) {
    res.status(500).json({ code: 1, message: err.message });
  }
});

module.exports = router;

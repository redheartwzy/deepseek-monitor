/**
 * Web Push（锁屏推送）
 *  - 服务端用 web-push 库 + VAPID 密钥向浏览器推送服务发消息
 *  - 订阅按用户隔离存在 push_subscriptions 表
 *  - 告警触发时由 scheduler 调用 sendPushToUser
 */
const webpush = require('web-push');
const db = require('../db');
const config = require('../config');

function isConfigured() {
  return Boolean(config.pushEnabled);
}

/** 配置 VAPID 详情（幂等） */
function init() {
  if (isConfigured()) {
    webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  }
}

/**
 * 保存订阅（按 endpoint 去重，同一端点重新订阅则更新密钥）。
 * @param {number} userId
 * @param {{endpoint:string, keys:{p256dh:string, auth:string}}} sub
 */
function saveSubscription(userId, sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return null;
  try {
    return db.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, keys_p256dh, keys_auth)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        keys_p256dh = excluded.keys_p256dh,
        keys_auth = excluded.keys_auth
    `).run(userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth);
  } catch (err) {
    console.error('[Push] 保存订阅失败:', err.message);
    return null;
  }
}

function removeSubscription(userId, endpoint) {
  if (!endpoint) return null;
  return db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(userId, endpoint);
}

function getSubscriptions(userId) {
  return db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
}

function countSubscriptions(userId) {
  return db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions WHERE user_id = ?').get(userId).c;
}

/**
 * 向某用户的所有推送订阅发送一条消息。
 * 订阅失效（404/410）自动清理。
 * @param {number} userId
 * @param {{title:string, body:string, url?:string}} payload
 * @returns {Promise<{sent:number, failed:number, total:number}>}
 */
async function sendPushToUser(userId, payload) {
  if (!isConfigured()) return { sent: 0, failed: 0, total: 0 };
  init();
  const subs = getSubscriptions(userId);
  if (!subs.length) return { sent: 0, failed: 0, total: 0 };

  let sent = 0, failed = 0;
  for (const s of subs) {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.keys_p256dh, auth: s.keys_auth } };
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload));
      sent++;
    } catch (err) {
      // 推送服务返回 404/410 = 订阅已失效，清理掉
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        removeSubscription(userId, s.endpoint);
      } else if (err && err.statusCode) {
        console.error(`[Push] 发送失败 (${err.statusCode}):`, err.message);
      } else {
        console.error('[Push] 发送异常:', err && err.message);
      }
      failed++;
    }
  }
  return { sent, failed, total: subs.length };
}

module.exports = {
  isConfigured, init, saveSubscription, removeSubscription,
  getSubscriptions, countSubscriptions, sendPushToUser
};

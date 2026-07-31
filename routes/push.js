/**
 * Web Push（锁屏推送）路由：VAPID 公钥、订阅管理、测试推送
 */
const express = require('express');
const router = express.Router();
const config = require('../config');
const push = require('../services/push');

/** 前端订阅用的 VAPID 公钥 + 该用户是否已订阅 */
router.get('/vapid-public-key', (req, res) => {
  res.json({
    code: 0,
    data: {
      key: config.vapid.publicKey,
      enabled: push.isConfigured(),
      subscribed: push.countSubscriptions(req.user.id) > 0
    }
  });
});

/** 保存浏览器推送订阅 */
router.post('/subscribe', (req, res) => {
  try {
    const sub = (req.body && (req.body.subscription || req.body)) || null;
    const result = push.saveSubscription(req.user.id, sub);
    if (!result) return res.status(400).json({ code: 1, message: '无效的订阅信息' });
    res.json({ code: 0, message: '订阅成功' });
  } catch (err) {
    res.status(500).json({ code: 1, message: err.message });
  }
});

/** 取消订阅（endpoint 传参） */
router.post('/unsubscribe', (req, res) => {
  try {
    const endpoint = req.body && req.body.endpoint;
    if (endpoint) push.removeSubscription(req.user.id, endpoint);
    res.json({ code: 0, message: '已取消订阅' });
  } catch (err) {
    res.status(500).json({ code: 1, message: err.message });
  }
});

/** 测试推送：验证「订阅 → 服务端 → 推送服务 → 设备」整条链路 */
router.post('/test', async (req, res) => {
  try {
    const result = await push.sendPushToUser(req.user.id, {
      title: 'DeepSeek Monitor',
      body: '这是一条测试锁屏推送 ✅',
      url: '/'
    });
    res.json({
      code: 0,
      data: result,
      message: result.sent > 0 ? `已发送 ${result.sent} 条` : '没有可用的推送订阅'
    });
  } catch (err) {
    res.status(500).json({ code: 1, message: err.message });
  }
});

module.exports = router;

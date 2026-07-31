/**
 * 模块三 + 模块九：多通道告警（notify.js）
 *  - 浏览器桌面通知（Notification API）
 *  - 移动端振动反馈（navigator.vibrate）
 *  - 余额不足强制弹窗（防忽略）
 *  - 页面顶部持续红色警告横幅
 */
import * as storage from './storage.js';

let bannerDismissed = false;

/** 页面加载时主动请求通知权限（需用户交互后浏览器才允许，但先申请） */
export function requestPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try { Notification.requestPermission().catch(() => {}); } catch { /* ignore */ }
  }
}

export function notificationGranted() {
  return 'Notification' in window && Notification.permission === 'granted';
}

/** 移动端振动反馈 */
export function vibrate() {
  if (navigator.vibrate) {
    try { navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
  }
}

/** 发送系统桌面通知（按“阈值桶”去重，避免每次轮询轰炸） */
export function sendLowBalanceNotification({ keyId = 'global', name, balance }) {
  if (!notificationGranted()) return;
  const bucket = Math.max(1, Math.floor(balance)); // 余额落到同一整数区间只提醒一次
  if (storage.notified.has(`notify:${keyId}`, bucket)) return;
  storage.notified.mark(`notify:${keyId}`, bucket);

  const body = `DeepSeek 余额不足，当前余额：¥${balance.toFixed(2)}，请及时充值！`;
  try {
    const n = new Notification(`${name} 余额告警`, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: 'dsm-low-balance'
    });
    n.onclick = () => { window.focus(); };
  } catch { /* ignore */ }
}

/** 余额首次跌破阈值区间时：通知 + 振动 + 强制弹窗 */
export function triggerAlerts(lowKeys) {
  if (!lowKeys || !lowKeys.length) return;
  let anyNew = false;
  for (const k of lowKeys) {
    const bucket = Math.max(1, Math.floor(k.balance));
    if (!storage.notified.has(`low:${k.keyId}`, bucket)) {
      storage.notified.mark(`low:${k.keyId}`, bucket);
      anyNew = true;
      sendLowBalanceNotification(k);
    }
  }
  if (anyNew) {
    vibrate();
    showLowBalanceModal(lowKeys);
  }
}

/** 余额不足强制弹窗（模块九） */
export function showLowBalanceModal(lowKeys) {
  const el = document.getElementById('lowBalanceModal');
  if (!el) return;
  const list = lowKeys
    .map(k => `
      <div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
        <span class="text-sm text-slate-700">${k.name}${k.isGlobal ? '（账号全局）' : ''}</span>
        <span class="font-bold text-rose-600">¥${k.balance.toFixed(2)}</span>
      </div>`)
    .join('');
  const bodyEl = document.getElementById('lowBalanceModalBody');
  if (bodyEl) bodyEl.innerHTML = list;
  el.classList.remove('hidden');
}

export function closeLowBalanceModal() {
  const el = document.getElementById('lowBalanceModal');
  if (el) el.classList.add('hidden');
}

/**
 * 页面顶部持续红色警告横幅。
 * 关闭横幅后（bannerDismissed）本轮不再显示；main.js 每次轮询前调用
 * resetBanner()，因此“下次轮询仍低于阈值”时会再次出现。
 */
export function renderBanner(lowKeys) {
  const el = document.getElementById('alertBanner');
  if (!el) return;
  if (!lowKeys || !lowKeys.length) {
    bannerDismissed = false;
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  if (bannerDismissed) {
    el.classList.add('hidden');
    return;
  }
  const items = lowKeys.map(k =>
    `<span class="px-1.5 py-0.5 bg-white/20 rounded font-mono">${k.name} ¥${k.balance.toFixed(2)}</span>`).join(' ');
  el.innerHTML = `
    <div class="alert-banner-inner">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="animate-pulse">🚨</span>
        <span class="truncate text-sm font-medium">余额不足：${items}，请及时充值！</span>
      </div>
      <div class="flex items-center gap-1 flex-shrink-0">
        <button data-action="low-balance-details" class="alert-banner-btn">查看详情</button>
        <button data-action="dismiss-banner" class="alert-banner-btn" title="关闭（下次轮询仍低会再次出现）">✕</button>
      </div>
    </div>`;
  el.classList.remove('hidden');
}

export function dismissBanner() { bannerDismissed = true; }
export function resetBanner() { bannerDismissed = false; }

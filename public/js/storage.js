/**
 * 模块二：localStorage 读写层（storage.js）
 *  - 缓存用量 / 密钥 / 告警数据：离线或限流时优先展示缓存；
 *  - UI 偏好：时间维度、模型筛选；
 *  - 告警去重与横幅关闭状态。
 */

const KEY = {
  usage: 'dsm.cache.usage',
  projects: 'dsm.cache.projects',
  alerts: 'dsm.cache.alerts',
  range: 'dsm.pref.rangeDays',
  model: 'dsm.pref.model',
  notified: 'dsm.notified',
  bannerDismissed: 'dsm.bannerDismissed'
};

function safeGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* 隐私模式等场景忽略 */ }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

// ===== 数据缓存（离线回退）=====
export const cache = {
  saveUsage: (d) => safeSet(KEY.usage, d),
  readUsage: () => safeGet(KEY.usage),
  saveProjects: (d) => safeSet(KEY.projects, d),
  readProjects: () => safeGet(KEY.projects),
  saveAlerts: (d) => safeSet(KEY.alerts, d),
  readAlerts: () => safeGet(KEY.alerts),
  has: () => Boolean(safeGet(KEY.usage))
};

// ===== UI 偏好 =====
export const prefs = {
  getRange: () => safeGet(KEY.range) || 7,
  setRange: (v) => safeSet(KEY.range, v),
  getModel: () => safeGet(KEY.model) || '全部',
  setModel: (v) => safeSet(KEY.model, v)
};

// ===== 通知去重（会话级）：同一密钥在同一阈值桶内只通知一次 =====
export const notified = {
  has(key, bucket) {
    const s = safeGet(KEY.notified) || {};
    return Boolean(s[`${key}|${bucket}`]);
  },
  mark(key, bucket) {
    const s = safeGet(KEY.notified) || {};
    s[`${key}|${bucket}`] = Date.now();
    safeSet(KEY.notified, s);
  }
};

// ===== 警告横幅关闭状态 =====
export const banner = {
  isDismissed: () => safeGet(KEY.bannerDismissed) === true,
  dismiss: () => safeSet(KEY.bannerDismissed, true),
  reset: () => safeRemove(KEY.bannerDismissed)
};

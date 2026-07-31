/**
 * 模块四：统一 API 请求层（api.js）
 * 所有异步请求走这里，统一处理网络错误 / 无效 Key / 限流。
 */
import { setConfig } from './config.js';

/**
 * 发起 JSON 请求。成功（code===0）返回 data；失败抛出带 kind 的 Error。
 * @param {string} path
 * @param {object} [opts]  fetch 选项
 * @returns {Promise<any>}
 */
export async function getJSON(path, opts = {}) {
  // 请求超时兜底：避免接口挂起时 Loading 遮罩一直挡住页面（导致所有按钮点不动）
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      signal: opts.signal || controller.signal,
      ...opts
    });
  } catch (err) {
    const e = new Error(
      err.name === 'AbortError'
        ? '请求超时，请稍后重试'
        : `网络请求失败：${err.message}，请检查后端服务是否在线`
    );
    e.kind = 'network';
    throw e;
  } finally {
    clearTimeout(timer);
  }

  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON 响应 */ }

  if (!res.ok || !body || body.code !== 0) {
    const msg = (body && (body.message || body.error)) || `请求失败 (HTTP ${res.status})`;
    const e = new Error(msg);
    if (res.status === 401 || res.status === 403) e.kind = 'unauthorized';
    else if (res.status === 429) e.kind = 'rate_limit';
    else e.kind = 'server';
    e.status = res.status;
    throw e;
  }
  return body.data;
}

// ===== 模块一：数据接口 =====
export const loadProjects = () => getJSON('/api/projects');
export const loadAlerts = () => getJSON('/api/data/alerts');
export const loadUsage = (days, model) =>
  getJSON(`/api/data/usage?days=${days}&model=${encodeURIComponent(model)}`);
export const loadConfig = async () => {
  const c = await getJSON('/api/config');
  setConfig(c);
  return c;
};

// ===== 登录系统 =====
/** 是否存在账号（true = 首次使用，默认展示注册） */
export const authFirst = () => getJSON('/api/auth/first');
/** 当前登录用户；未登录返回 null（不抛错） */
export async function authMe() {
  try { return await getJSON('/api/auth/me'); } catch { return null; }
}
export const register = (data) => getJSON('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
export const login = (username, password) =>
  getJSON('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const logout = () => getJSON('/api/auth/logout', { method: 'POST' });
export const changePassword = (current_password, new_password) =>
  getJSON('/api/auth/change-password',
    { method: 'POST', body: JSON.stringify({ current_password, new_password }) });

// ===== 模块七：密钥管理 =====
export const createProject = (data) => getJSON('/api/projects', { method: 'POST', body: JSON.stringify(data) });
export const updateProject = (id, data) => getJSON(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteProject = (id) => getJSON(`/api/projects/${id}`, { method: 'DELETE' });

// ===== 告警 =====
export const ackAlert = (id) => getJSON(`/api/data/alerts/${id}/ack`, { method: 'PUT' });

// ===== Web Push（锁屏推送）=====
export const getPushStatus = () => getJSON('/api/push/vapid-public-key');
export const subscribePush = (subscription) =>
  getJSON('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
export const unsubscribePush = (endpoint) =>
  getJSON('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
export const testPush = () => getJSON('/api/push/test', { method: 'POST' });

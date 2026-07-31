/**
 * 模块一/七：主入口（main.js）
 * 状态管理、定时轮询、手动刷新、事件绑定。
 */
import * as api from './api.js';
import * as storage from './storage.js';
import * as notify from './notify.js';
import {
  render, showToast, computeLowKeys, setLoading
} from './ui.js';
import { getRefreshInterval, getBalanceThreshold } from './config.js';

const state = {
  config: { refreshIntervalMs: 60000, emailConfigured: false },
  user: null,
  projects: [],
  globalBalance: null,
  alerts: [],
  usage: null,
  currentTab: 'dashboard',
  rangeDays: storage.prefs.getRange(),
  modelFilter: storage.prefs.getModel(),
  lastUpdated: null,
  loading: false,
  error: null,
  fromCache: false,
  pushSubscribed: false
};

const $ = (id) => document.getElementById(id);

let pollTimer = null;

// ================= 数据拉取 =================

async function poll({ manual = false } = {}) {
  if (state.loading && !manual) return;
  state.loading = true;
  state.error = null;
  notify.resetBanner();
  render(state);

  try {
    const [proj, alerts, usage] = await Promise.all([
      api.loadProjects(),
      api.loadAlerts(),
      api.loadUsage(state.rangeDays, state.modelFilter)
    ]);
    state.projects = (proj && proj.projects) || [];
    state.globalBalance = proj && proj.global_balance != null ? proj.global_balance : null;
    state.alerts = alerts || [];
    state.usage = usage;
    state.lastUpdated = new Date();
    state.fromCache = false;

    // 成功 → 写入缓存（模块二：离线时优先展示缓存数据）
    storage.cache.saveProjects(state.projects);
    storage.cache.saveAlerts(state.alerts);
    storage.cache.saveUsage(state.usage);
  } catch (err) {
    // 网络离线 / API 限流 → 回退缓存
    const cachedUsage = storage.cache.readUsage();
    const cachedProjects = storage.cache.readProjects();
    const cachedAlerts = storage.cache.readAlerts();
    if (cachedUsage || cachedProjects) {
      if (cachedUsage) state.usage = cachedUsage;
      if (cachedProjects) state.projects = cachedProjects;
      if (cachedAlerts) state.alerts = cachedAlerts;
      state.fromCache = true;
    }
    state.error = err;
    showToast(err.message, 'error');
  } finally {
    state.loading = false;
    render(state);

    // 模块三/九：余额不足 → 系统通知 + 振动 + 强制弹窗
    const low = computeLowKeys(state);
    notify.triggerAlerts(low);
  }
}

async function refresh() {
  await poll({ manual: true });
}

/** 延时再刷新一次：配合后端“立即轮询”，让刚添加 / 编辑的密钥余额尽快出现 */
function refreshSoon(delay = 5000) {
  setTimeout(() => {
    if (state.loading || pollTimer === null) return;
    poll();
  }, delay);
}

// ================= 登录 / 注册 =================

function switchAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach(b => {
    b.classList.toggle('auth-tab-active', b.dataset.authTab === tab);
  });
  $('loginForm').classList.toggle('hidden', tab !== 'login');
  $('registerForm').classList.toggle('hidden', tab !== 'register');
}

function showAuthScreen(first) {
  switchAuthTab(first ? 'register' : 'login');
  $('authScreen').classList.remove('hidden');
  $('authError').classList.add('hidden');
}

function hideAuthScreen() {
  $('authScreen').classList.add('hidden');
}

function showAuthError(msg) {
  const el = $('authError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function onAuthed(user) {
  state.user = user;
  hideAuthScreen();
  refresh();
}

async function submitLogin(e) {
  e.preventDefault();
  try {
    const user = await api.login($('loginUsername').value.trim(), $('loginPassword').value);
    onAuthed(user);
  } catch (err) {
    showAuthError(err.message || '登录失败');
  }
}

async function submitRegister(e) {
  e.preventDefault();
  const pw = $('regPassword').value;
  if (pw !== $('regPassword2').value) {
    showAuthError('两次输入的密码不一致');
    return;
  }
  try {
    const user = await api.register({
      username: $('regUsername').value.trim(),
      password: pw,
      display_name: $('regDisplayName').value.trim(),
      api_key: $('regApiKey').value.trim(),
      email: $('regEmail').value.trim()
    });
    onAuthed(user);
  } catch (err) {
    showAuthError(err.message || '注册失败');
  }
}

async function doLogout() {
  try { await api.logout(); } catch { /* 忽略 */ }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  state.user = null;
  showAuthScreen(false);
}

// ================= 锁屏推送 =================

async function refreshPushStatus() {
  try {
    const data = await api.getPushStatus();
    state.pushSubscribed = !!(data && data.subscribed);
  } catch { /* 忽略 */ }
}

async function togglePush() {
  try {
    if (state.pushSubscribed) {
      await notify.unsubscribePush();
      state.pushSubscribed = false;
      showToast('已关闭锁屏推送');
    } else {
      showToast('正在请求权限并订阅…');
      const r = await notify.subscribePush();
      if (r.ok) {
        state.pushSubscribed = true;
        showToast('锁屏推送已开启');
      } else {
        showToast(r.reason || '开启失败', 'error');
      }
    }
    render(state);
  } catch (err) {
    showToast(err.message || '操作失败', 'error');
  }
}

async function sendTestPush() {
  try {
    const { message } = await api.testPush();
    showToast(message || '已发送测试推送');
  } catch (err) {
    showToast(err.message || '发送失败', 'error');
  }
}

// ================= 修改密码 =================

function openPwdModal() {
  $('pwdCurrent').value = '';
  $('pwdNew').value = '';
  $('pwdNew2').value = '';
  $('pwdModal').classList.remove('hidden');
}

function closePwdModal() {
  $('pwdModal').classList.add('hidden');
}

async function submitPwd(e) {
  e.preventDefault();
  const current = $('pwdCurrent').value;
  const next = $('pwdNew').value;
  if (next !== $('pwdNew2').value) {
    showToast('两次输入的新密码不一致', 'error');
    return;
  }
  if (next.length < 6) {
    showToast('新密码至少 6 位', 'error');
    return;
  }
  try {
    await api.changePassword(current, next);
    showToast('密码已修改');
    closePwdModal();
  } catch (err) {
    showToast(err.message || '修改失败', 'error');
  }
}

// ================= Tab =================

function switchTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('tab-active', active);
    b.classList.toggle('text-slate-400', !active);
    b.classList.toggle('text-blue-600', active);
  });
  render(state);
}

// ================= 密钥管理 =================

function openKeyForm(id) {
  const p = id ? (state.projects || []).find(x => String(x.id) === String(id)) : null;
  $('formId').value = id || '';
  $('formTitle').textContent = p ? '编辑密钥' : '添加 API 密钥';
  $('formName').value = p ? p.name : '';
  $('formKey').value = '';
  $('formKey').placeholder = p
    ? `${p.api_key_preview || '已设置'}（留空则保持不变）`
    : 'sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  $('formBalanceThreshold').value = p ? (p.balance_threshold ?? getBalanceThreshold()) : getBalanceThreshold();
  $('formRateThreshold').value = p ? p.rate_threshold : 5;
  $('formIsDefault').checked = p ? p.is_default : false;
  $('formModal').classList.remove('hidden');
}

function closeForm() { $('formModal').classList.add('hidden'); }

async function submitKey(e) {
  e.preventDefault();
  const id = $('formId').value;
  const data = {
    name: $('formName').value.trim(),
    balance_threshold: parseFloat($('formBalanceThreshold').value) || getBalanceThreshold(),
    rate_threshold: parseFloat($('formRateThreshold').value) || 5,
    is_default: $('formIsDefault').checked
  };
  const keyVal = $('formKey').value.trim();
  if (keyVal) data.api_key = keyVal;
  if (!data.name || (!id && !data.api_key)) {
    showToast('请填写名称与 API Key', 'error');
    return;
  }
  try {
    if (id) await api.updateProject(id, data);
    else await api.createProject(data);
    showToast(id ? '已更新' : '已添加');
    closeForm();
    await refresh();
    refreshSoon(); // 后端已立即轮询，稍后再拉一次以显示最新余额
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function toggleKey(id) {
  const p = state.projects.find(x => String(x.id) === String(id));
  if (!p) return;
  try {
    await api.updateProject(id, { enabled: !p.enabled });
    await refresh();
    refreshSoon();
  } catch (err) { showToast(err.message, 'error'); }
}

async function setDefault(id) {
  try {
    await api.updateProject(id, { is_default: true });
    showToast('已设为默认密钥');
    await refresh();
    refreshSoon();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteKey(id) {
  if (!confirm('确认删除此密钥？相关余额快照与告警将一并清除。')) return;
  try {
    await api.deleteProject(id);
    showToast('已删除');
    await refresh();
  } catch (err) { showToast(err.message, 'error'); }
}

async function ack(id) {
  try {
    await api.ackAlert(id);
    state.alerts = state.alerts.filter(a => String(a.id) !== String(id));
    render(state);
  } catch (err) { showToast(err.message, 'error'); }
}

// ================= 事件绑定 =================

function handleAction(action, id) {
  switch (action) {
    case 'refresh': refresh(); break;
    case 'switch-tab':
      if (id) switchTab(id); break;
    case 'set-range':
      state.rangeDays = parseInt(id, 10) || 7;
      storage.prefs.setRange(state.rangeDays);
      refresh();
      break;
    case 'dismiss-banner':
      notify.dismissBanner();
      render(state);
      break;
    case 'low-balance-details':
      switchTab('alerts');
      break;
    case 'open-key-form': openKeyForm(); break;
    case 'edit-key': openKeyForm(id); break;
    case 'toggle-key': toggleKey(id); break;
    case 'set-default': setDefault(id); break;
    case 'delete-key': deleteKey(id); break;
    case 'ack-alert': ack(id); break;
    case 'close-form': closeForm(); break;
    case 'close-low-balance-modal': notify.closeLowBalanceModal(); break;
    case 'request-notify': notify.requestPermission(); break;
    case 'logout': doLogout(); break;
    case 'open-pwd-modal': openPwdModal(); break;
    case 'close-pwd-modal': closePwdModal(); break;
    case 'toggle-push': togglePush(); break;
    case 'test-push': sendTestPush(); break;
    default: break;
  }
}

function wireEvents() {
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (target) {
      handleAction(target.dataset.action, target.dataset.id || target.dataset.tab || target.dataset.days);
      return;
    }
    // 兜底：老式 tab-btn（仅 data-tab、无 data-action）也能切换
    const tabBtn = e.target.closest('.tab-btn');
    if (tabBtn && tabBtn.dataset.tab) switchTab(tabBtn.dataset.tab);
  });
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'modelSelect') {
      state.modelFilter = e.target.value;
      storage.prefs.setModel(state.modelFilter);
      refresh();
    }
  });
  $('projectForm').addEventListener('submit', submitKey);
  $('pwdForm').addEventListener('submit', submitPwd);

  // 登录 / 注册界面事件
  document.querySelectorAll('[data-auth-tab]').forEach(b =>
    b.addEventListener('click', () => switchAuthTab(b.dataset.authTab)));
  $('loginForm').addEventListener('submit', submitLogin);
  $('registerForm').addEventListener('submit', submitRegister);
}

function clock() {
  const el = $('clock');
  setInterval(() => { if (el) el.textContent = new Date().toLocaleTimeString(); }, 1000);
}

// ================= 启动 =================

async function init() {
  clock();
  wireEvents();
  switchTab('dashboard');
  setLoading(true);

  try {
    state.config = await api.loadConfig();
  } catch { /* 未登录（401）或异常时使用默认前端配置 */ }

  notify.requestPermission();

  // 登录守卫：未登录则停留在登录 / 注册页，不启动轮询
  const me = await api.authMe();
  if (!me) {
    setLoading(false);
    let first = false;
    try { first = (await api.authFirst()).first; } catch { /* 忽略 */ }
    showAuthScreen(first);
    return;
  }

  state.user = me;
  hideAuthScreen();
  await refresh();
  await refreshPushStatus();

  pollTimer = setInterval(() => poll(), getRefreshInterval());
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();

/**
 * 模块一/七：主入口（main.js）
 * 状态管理、定时轮询、手动刷新、事件绑定。
 */
import * as api from './api.js';
import * as storage from './storage.js';
import * as notify from './notify.js';
import { renderSparkline } from './chart.js';
import {
  render, showToast, computeLowKeys, setLoading
} from './ui.js';
import { getRefreshInterval, getBalanceThreshold } from './config.js';

const state = {
  config: { refreshIntervalMs: 60000, emailConfigured: false },
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
  fromCache: false
};

const $ = (id) => document.getElementById(id);

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

    loadKeySparklines();
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

/** 为每个启用密钥加载近 30 天余额 sparkline（失败则忽略） */
async function loadKeySparklines() {
  const enabled = (state.projects || []).filter(p => p.enabled);
  await Promise.all(enabled.map(async (p) => {
    try {
      const data = await api.getJSON(`/api/data/snapshots/${p.id}?days=30`);
      const values = (data || []).map(s => s.balance).filter(v => v != null);
      renderSparkline(`spark-${p.id}`, values);
    } catch { /* 无 sparkline 数据 */ }
  }));
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
  } catch (err) { showToast(err.message, 'error'); }
}

async function setDefault(id) {
  try {
    await api.updateProject(id, { is_default: true });
    showToast('已设为默认密钥');
    await refresh();
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
  } catch { /* 使用默认前端配置 */ }

  notify.requestPermission();
  await refresh();

  setInterval(() => poll(), getRefreshInterval());
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

init();

/**
 * 模块一/二/七：DOM 渲染层（ui.js）
 * 负责统计卡片、时间维度切换、模型筛选、密钥管理、告警列表等全部 UI。
 */
import { renderUsageChart, destroySparklines } from './chart.js';
import { renderBanner } from './notify.js';
import { getBalanceThreshold } from './config.js';

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function fmtTime(s) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 计算处于“低余额”状态的密钥（含账号全局） */
export function computeLowKeys(state) {
  const low = (state.projects || [])
    .filter(p => p.enabled && p.last_balance != null)
    .filter(p => p.last_balance < (p.balance_threshold ?? getBalanceThreshold()))
    .map(p => ({ keyId: `k${p.id}`, name: p.name, balance: p.last_balance, isGlobal: false }));

  if (state.globalBalance != null && state.globalBalance < getBalanceThreshold()) {
    low.push({ keyId: 'global', name: '账号全局', balance: state.globalBalance, isGlobal: true });
  }
  return low;
}

export function showToast(msg, type = 'success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + (
    type === 'error'
      ? '!bg-rose-50 !text-rose-700 !border !border-rose-200'
      : '!bg-emerald-50 !text-emerald-700 !border !border-emerald-200');
  t.classList.remove('hidden');
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.classList.add('hidden'), 300);
  }, 2500);
}

export function setLoading(loading) {
  const el = $('loadingOverlay');
  if (!el) return;
  el.classList.toggle('hidden', !loading);
}

/** 展示 / 隐藏错误横幅 */
export function showError(err) {
  const el = $('errorBanner');
  if (!el) return;
  if (!err) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="flex items-center gap-2">
      <span>⚠️</span>
      <span class="flex-1 text-sm">${esc(err.message || String(err))}</span>
      <button data-action="refresh" class="alert-banner-btn">重试</button>
    </div>`;
}

/** 顶部栏：上次更新时间 + 刷新按钮状态 + 缓存提示 */
export function updateHeader(state) {
  const lastEl = $('lastUpdated');
  if (lastEl) lastEl.textContent = state.lastUpdated ? fmtTime(state.lastUpdated) : '—';

  const btn = $('refreshBtn');
  if (btn) {
    btn.classList.toggle('opacity-60', !!state.loading);
    btn.disabled = !!state.loading;
  }

  const cacheEl = $('cacheHint');
  if (cacheEl) cacheEl.classList.toggle('hidden', !state.fromCache);

  const bell = $('notifyBadge');
  if (bell) {
    const granted = 'Notification' in window && Notification.permission === 'granted';
    bell.className = 'w-8 h-8 flex items-center justify-center rounded-full text-sm ' +
      (granted ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400');
    bell.title = granted ? '桌面通知已开启' : '桌面通知未开启，点击开启';
    bell.textContent = granted ? '🔔' : '🔕';
  }
}

/** 顶部渲染入口 */
export function render(state) {
  setLoading(state.loading);
  updateHeader(state);
  showError(state.error);

  destroySparklines();

  const content = $('pageContent');
  if (!content) return;

  if (state.currentTab === 'dashboard') renderDashboard(state, content);
  else if (state.currentTab === 'management') renderManagement(state, content);
  else if (state.currentTab === 'alerts') renderAlerts(state, content);

  // 顶部警告横幅（模块三/九）
  renderBanner(computeLowKeys(state));
}

// ================= Dashboard =================

function renderDashboard(state, el) {
  const summary = (state.usage && state.usage.summary) || { totalCost: 0, totalRequests: null, totalTokens: null };
  const daily = (state.usage && state.usage.daily) || [];
  const models = (state.usage && state.usage.models) || ['全部'];
  const hasUsageAPI = models.length > 1;

  const fmtCount = (v) => v == null ? '<span class="text-slate-300" title="未配置用量接口，无法统计">—</span>' : Number(v).toLocaleString();

  const rangeBtn = (days, label) =>
    `<button data-action="set-range" data-days="${days}" class="range-btn ${state.rangeDays === days ? 'range-active' : ''}">${label}</button>`;

  const modelOpts = models.map(m =>
    `<option value="${esc(m)}" ${m === state.modelFilter ? 'selected' : ''}>${esc(m)}</option>`).join('');

  const keyCards = (state.projects || []).map(p => {
    const low = p.enabled && p.last_balance != null && p.last_balance < (p.balance_threshold ?? getBalanceThreshold());
    const rate = p.daily_rate || 0;
    const rateHigh = rate > p.rate_threshold;
    return `
      <div class="card" data-id="${p.id}">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${p.enabled ? 'bg-emerald-400' : 'bg-slate-300'}"></span>
            <span class="font-semibold text-slate-800 truncate">${esc(p.name)}</span>
            ${p.is_default ? '<span class="badge bg-blue-50 text-blue-600 border border-blue-200">默认</span>' : ''}
            ${low ? '<span class="badge bg-rose-50 text-rose-700 border border-rose-200">余额不足</span>'
                 : (p.enabled ? '<span class="badge bg-emerald-50 text-emerald-700 border border-emerald-200">正常</span>'
                              : '<span class="badge bg-slate-50 text-slate-500 border border-slate-200">已暂停</span>')}
            ${rateHigh ? '<span class="badge bg-amber-50 text-amber-700 border border-amber-200">消耗过快</span>' : ''}
          </div>
          <span class="text-xs text-slate-400 tabular-nums">${p.last_balance != null ? '¥' + Number(p.last_balance).toFixed(2) : '未获取'}</span>
        </div>
        <div class="flex items-center gap-5 text-sm text-slate-500 mb-3">
          <span>余额阈值: <strong class="text-slate-700">¥${Number(p.balance_threshold ?? getBalanceThreshold()).toFixed(2)}</strong></span>
          <span>估算日耗: <strong class="${rateHigh ? 'text-amber-600' : 'text-slate-700'}">¥${rate.toFixed(2)}</strong></span>
          <span>更新: <span class="text-xs text-slate-400">${fmtTime(p.last_fetched_at)}</span></span>
        </div>
        <div class="chart-wrap h-14"><canvas id="spark-${p.id}"></canvas></div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="space-y-4 fade-in">
      <!-- 汇总统计卡片 -->
      <div class="grid grid-cols-3 gap-3">
        <div class="card text-center py-4">
          <p class="text-xs text-slate-400 mb-1">总消费金额 (CNY)</p>
          <p class="text-2xl font-bold text-slate-800 tabular-nums">¥${Number(summary.totalCost || 0).toFixed(2)}</p>
        </div>
        <div class="card text-center py-4">
          <p class="text-xs text-slate-400 mb-1">API 请求次数</p>
          <p class="text-2xl font-bold text-slate-800 tabular-nums">${fmtCount(summary.totalRequests)}</p>
        </div>
        <div class="card text-center py-4">
          <p class="text-xs text-slate-400 mb-1">Tokens 总数</p>
          <p class="text-2xl font-bold text-slate-800 tabular-nums">${fmtCount(summary.totalTokens)}</p>
        </div>
      </div>

      <!-- 时间维度 + 模型筛选 -->
      <div class="flex items-center gap-3">
        <div class="flex bg-slate-100 rounded-xl p-1">
          ${rangeBtn(7, '近7天')}${rangeBtn(30, '近30天')}${rangeBtn(90, '近90天')}
        </div>
        <select id="modelSelect" class="!w-44 !py-2 text-sm" title="模型筛选">
          ${modelOpts}
        </select>
        ${hasUsageAPI ? '' : '<span class="text-[11px] text-slate-400">未配置用量接口，按余额快照推导消费</span>'}
      </div>

      <!-- 消费趋势主图 -->
      <div class="card">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-slate-800 text-sm">消费趋势（CNY / 天）</h3>
          <span class="text-xs text-slate-400">悬停查看明细</span>
        </div>
        <div class="chart-wrap h-72"><canvas id="usageChart"></canvas></div>
      </div>

      <!-- 密钥余额卡片 -->
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-slate-800 text-sm">密钥余额</h3>
          <button data-action="open-key-form" class="text-blue-600 text-sm font-medium">+ 添加</button>
        </div>
        ${keyCards || '<div class="text-center py-10 text-slate-400">暂无密钥，点击右上角“添加”录入 API Key</div>'}
      </div>
    </div>`;

  // 图表绘制（主图 + 密钥 sparkline 由 main.js 异步补充）
  renderUsageChart('usageChart', daily);
}

// ================= Management =================

function renderManagement(state, el) {
  const rows = (state.projects || []).map(p => {
    const low = p.enabled && p.last_balance != null && p.last_balance < (p.balance_threshold ?? getBalanceThreshold());
    return `
      <div class="card" data-id="${p.id}">
        <div class="flex items-center justify-between mb-2">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium text-slate-800">${esc(p.name)}</span>
              ${p.is_default ? '<span class="badge bg-blue-50 text-blue-600 border border-blue-200">默认</span>' : ''}
              ${low ? '<span class="badge bg-rose-50 text-rose-700 border border-rose-200">余额不足</span>' : ''}
            </div>
            <p class="text-xs text-slate-400 mt-1 font-mono">${esc(p.api_key_preview || '')} · 更新于 ${fmtTime(p.last_fetched_at)}</p>
            ${p.last_error ? `<p class="text-xs text-rose-500 mt-1">⚠ ${esc(p.last_error)}</p>` : ''}
          </div>
          <div class="flex items-center gap-2 ml-3">
            <button class="toggle ${p.enabled ? 'on' : 'off'}" data-action="toggle-key" data-id="${p.id}" title="${p.enabled ? '暂停监控' : '恢复监控'}"></button>
            <button data-action="edit-key" data-id="${p.id}" class="btn-ghost text-sm text-blue-600">编辑</button>
            <button data-action="set-default" data-id="${p.id}" class="btn-ghost text-sm text-emerald-600">设为默认</button>
            <button data-action="delete-key" data-id="${p.id}" class="btn-ghost text-sm text-rose-600">删除</button>
          </div>
        </div>
        <div class="flex items-center gap-5 text-sm text-slate-500">
          <span>余额: <strong class="${low ? 'text-rose-600' : 'text-slate-700'}">¥${p.last_balance != null ? Number(p.last_balance).toFixed(2) : '—'}</strong></span>
          <span>独立阈值: ¥${Number(p.balance_threshold ?? getBalanceThreshold()).toFixed(2)}</span>
          <span>速率阈值: ¥${Number(p.rate_threshold).toFixed(2)}/天</span>
        </div>
      </div>`;
  }).join('');

  const emailStatus = state.config && state.config.emailConfigured
    ? '<span class="badge bg-emerald-50 text-emerald-700 border border-emerald-200">已启用</span>'
    : '<span class="badge bg-slate-50 text-slate-500 border border-slate-200">未配置</span>';

  el.innerHTML = `
    <div class="fade-in space-y-4">
      <button data-action="open-key-form" class="btn btn-primary w-full flex items-center justify-center gap-2 py-3">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        添加 API 密钥
      </button>

      <div class="card text-sm text-slate-500 flex items-center justify-between">
        <div>
          <p class="font-semibold text-slate-800 text-sm mb-0.5">邮件告警（模块八）</p>
          <p class="text-xs">余额低于阈值时每小时发送提醒邮件</p>
        </div>
        ${emailStatus}
      </div>

      <div class="space-y-3">
        ${rows || '<div class="text-center py-12 text-slate-400">暂无密钥</div>'}
      </div>
    </div>`;
}

// ================= Alerts =================

function renderAlerts(state, el) {
  const list = (state.alerts || []);
  const badge = (a) => {
    if (a.type === 'global_low_balance' || a.type === 'key_low_balance')
      return { badge: 'bg-rose-50 text-rose-700 border border-rose-200', label: '余额告警', dot: 'bg-rose-500' };
    if (a.type === 'high_rate')
      return { badge: 'bg-amber-50 text-amber-700 border border-amber-200', label: '消耗超限', dot: 'bg-amber-500' };
    return { badge: 'bg-slate-50 text-slate-600 border border-slate-200', label: '通知', dot: 'bg-slate-400' };
  };

  if (!list.length) {
    el.innerHTML = `
      <div class="text-center py-20 text-slate-400 fade-in">
        <svg class="w-14 h-14 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <p>暂无未确认告警</p>
        <p class="text-xs mt-2">余额跌破阈值时会通过横幅、系统通知、振动与邮件提醒你</p>
      </div>`;
    return;
  }

  const html = list.map(a => {
    const b = badge(a);
    return `
      <div class="card flex items-start gap-3 fade-in">
        <span class="w-2.5 h-2.5 rounded-full mt-1.5 ${b.dot} flex-shrink-0"></span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class="font-medium text-slate-800 text-sm">${esc(a.project_name || '账号全局')}</span>
            <span class="badge ${b.badge}">${b.label}</span>
          </div>
          <p class="text-sm text-slate-500">${esc(a.message)}</p>
          <p class="text-xs text-slate-400 mt-1">${fmtTime(a.triggered_at)}</p>
        </div>
        <button data-action="ack-alert" data-id="${a.id}" class="btn-ghost text-xs text-blue-600 whitespace-nowrap font-medium">标为已读</button>
      </div>`;
  }).join('');

  el.innerHTML = `<div class="space-y-3 fade-in">${html}</div>`;
}

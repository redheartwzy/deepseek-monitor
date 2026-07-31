/**
 * 模块二：Chart.js 图表渲染（chart.js）
 *  - 主折线图：X=日期，Y=消费金额，tooltip 悬停显示数值，平滑动画更新
 *  - 密钥卡片 sparkline：近 30 天余额小趋势
 */
let usageChart = null;
const sparklines = [];

function fmtDate(dateStr) {
  const parts = String(dateStr).split('-');
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}

/** 主折线图（每次调用平滑更新，复用单个实例） */
export function renderUsageChart(canvasId, daily) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return;
  const ctx = canvas.getContext('2d');

  const labels = daily.map(d => fmtDate(d.date));
  const values = daily.map(d => d.cost);

  if (usageChart) { usageChart.destroy(); usageChart = null; }

  usageChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '消费金额 (CNY)',
        data: values,
        borderColor: '#3b82f6',
        backgroundColor: (context) => {
          const { ctx: c, chartArea } = context.chart;
          if (!chartArea) return 'rgba(59,130,246,0.08)';
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, 'rgba(59,130,246,0.18)');
          g.addColorStop(1, 'rgba(59,130,246,0.02)');
          return g;
        },
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: '#3b82f6',
        pointBorderColor: '#fff',
        borderWidth: 2.5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.92)',
          titleColor: '#e2e8f0',
          bodyColor: '#f8fafc',
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (item) => {
              const d = daily[item.dataIndex];
              const lines = [`💰 ¥ ${Number(d.cost).toFixed(4)}`];
              if (d.requests != null) lines.push(`📮 请求次数：${Number(d.requests).toLocaleString()}`);
              if (d.tokens != null) lines.push(`🔤 Tokens：${Number(d.tokens).toLocaleString()}`);
              return lines;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxTicksLimit: 8, font: { size: 11 } },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { color: '#94a3b8', font: { size: 11 }, callback: v => `¥${v.toFixed(1)}` },
          grid: { color: '#f1f5f9' }
        }
      }
    }
  });
}

/** 密钥卡片 sparkline（近 30 天余额趋势） */
export function renderSparkline(canvasId, values, color = '#3b82f6') {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined' || !values || values.length < 2) return;
  const ctx = canvas.getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: values.map((_, i) => i),
      datasets: [{
        data: values,
        borderColor: color,
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
  sparklines.push(chart);
}

/** 页面重渲染前销毁旧 sparkline，防止内存泄漏 */
export function destroySparklines() {
  while (sparklines.length) sparklines.pop().destroy();
}

export function destroyUsageChart() {
  if (usageChart) { usageChart.destroy(); usageChart = null; }
}

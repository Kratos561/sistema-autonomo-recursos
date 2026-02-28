const API = '/api';
let currentTab = 'overview';

// ── Fetch helper ────────────────────────────────────────
async function api(endpoint) {
  try {
    const res = await fetch(`${API}${endpoint}`);
    const data = await res.json();
    return data.data || data;
  } catch (err) {
    console.error('API Error:', err);
    return null;
  }
}

// ── Format date ─────────────────────────────────────────
function timeAgo(date) {
  if (!date) return 'nunca';
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `hace ${seconds}s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)}h`;
  return `hace ${Math.floor(seconds / 86400)}d`;
}

// ── Score styling ───────────────────────────────────────
function scoreColorCss(score) {
  if (score >= 60) return 'text-accent-emerald bg-accent-emerald/10 border-accent-emerald/20';
  if (score >= 30) return 'text-primary bg-primary/10 border-primary/20';
  return 'text-slate-400 bg-white/5 border-white/10';
}
function scoreTextColor(score) {
  if (score >= 60) return 'text-accent-emerald';
  if (score >= 30) return 'text-primary';
  return 'text-slate-400';
}

// ── Load Overview ───────────────────────────────────────
async function loadOverview() {
  const stats = await api('/stats');
  if (!stats) return;

  document.getElementById('total-resources').textContent = stats.total_resources || 0;

  const apis = stats.by_type?.find(t => t.type === 'api')?.count || 0;
  document.getElementById('total-apis').textContent = apis;

  const databases = stats.by_type?.find(t => t.type === 'database')?.count || 0;
  const vps = stats.by_type?.find(t => t.type === 'vps')?.count || 0;
  document.getElementById('total-infra').textContent = parseInt(databases) + parseInt(vps);

  const high = stats.top_resources?.filter(r => parseFloat(r.final_score) >= 60).length || 0;
  document.getElementById('total-gems').textContent = high;

  // Top Resources
  const topContainer = document.getElementById('top-resources');
  if (stats.top_resources && stats.top_resources.length > 0) {
    topContainer.innerHTML = stats.top_resources.map((r, i) => `
      <div class="flex items-center gap-4 p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors cursor-pointer" onclick="window.open('${r.url}', '_blank')">
        <div class="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <span class="text-xl font-bold ${scoreTextColor(parseFloat(r.final_score))}">${i + 1}</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-bold text-white truncate">${escapeHtml(r.name)}</p>
          <div class="flex gap-2 mt-1">
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-white/10 text-slate-300 border border-white/5">${r.type || 'other'}</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-white/10 text-slate-300 border border-white/5">${r.domain || 'general'}</span>
          </div>
        </div>
        <div class="flex flex-col items-end">
          <span class="px-3 py-1 rounded-full text-xs font-bold border ${scoreColorCss(parseFloat(r.final_score))}">${parseFloat(r.final_score).toFixed(0)}</span>
        </div>
      </div>
    `).join('');
  } else {
    topContainer.innerHTML = '<div class="text-slate-500 text-sm text-center py-10">No top resources yet.</div>';
  }

  // Recent Alerts
  const alertsContainer = document.getElementById('recent-alerts');
  if (stats.recent_alerts && stats.recent_alerts.length > 0) {
    alertsContainer.innerHTML = stats.recent_alerts.map(a => `
      <div class="flex items-start gap-4 p-3 rounded-2xl bg-white/5 border border-white/5">
        <div class="w-10 h-10 rounded-xl bg-accent-purple/20 flex items-center justify-center shrink-0">
          <span class="material-symbols-outlined text-accent-purple">notifications</span>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-bold text-white">${escapeHtml(a.title)}</p>
          <p class="text-xs text-slate-400 mt-1">${escapeHtml(a.message || '')}</p>
        </div>
        <span class="text-[10px] text-slate-500 whitespace-nowrap">${timeAgo(a.created_at)}</span>
      </div>
    `).join('');
  } else {
    alertsContainer.innerHTML = '<div class="text-slate-500 text-sm text-center py-10">No recent alerts.</div>';
  }

  // Logs Update (only if active)
  if (currentTab === 'logs') loadLogs();
}

// ── Load Resources Tab ───────────────────────────────────
async function loadResources() {
  const type = document.getElementById('filter-type')?.value || '';
  const domain = document.getElementById('filter-domain')?.value || '';
  const minScore = document.getElementById('filter-score')?.value || '';

  let queryParams = '?limit=50';
  if (type) queryParams += `&type=${type}`;
  if (domain) queryParams += `&domain=${domain}`;
  if (minScore) queryParams += `&min_score=${minScore}`;

  const container = document.getElementById('all-resources');
  container.innerHTML = `<div class="col-span-1 md:col-span-2 xl:col-span-3 text-center py-10"><div class="animate-pulse flex items-center justify-center gap-2 text-slate-400"><span class="material-symbols-outlined animate-spin text-primary">sync</span> fetching data...</div></div>`;

  const data = await api(`/resources${queryParams}`);

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="col-span-1 md:col-span-2 xl:col-span-3 text-center text-slate-500 py-10">No resources matched filters.</div>';
    return;
  }

  const resources = Array.isArray(data) ? data : [];
  container.innerHTML = resources.map(r => `
    <div class="glass p-6 rounded-3xl border border-white/5 hover:border-white/20 transition-all group flex flex-col h-full cursor-pointer relative overflow-hidden" onclick="window.open('${r.url}', '_blank')">
      
      <div class="flex justify-between items-start mb-4 relative z-10">
        <h3 class="text-lg font-bold text-white group-hover:text-primary transition-colors pr-10 leading-tight">${escapeHtml(r.name)}</h3>
        <div class="px-3 py-1 rounded-full text-xs font-bold border absolute top-0 right-0 ${scoreColorCss(parseFloat(r.final_score || 0))}">${parseFloat(r.final_score || 0).toFixed(0)}</div>
      </div>
      
      <p class="text-sm text-slate-400 mb-6 flex-1 line-clamp-3 relative z-10">${escapeHtml(r.description || 'No description provided by crawler.')}</p>
      
      <div class="flex flex-wrap gap-2 mb-4 relative z-10">
        <span class="px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-white/5 text-slate-300 border border-white/10 flex items-center gap-1"><span class="material-symbols-outlined text-[12px] opacity-70">category</span>${r.type || 'other'}</span>
        <span class="px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-white/5 text-slate-300 border border-white/10 flex items-center gap-1"><span class="material-symbols-outlined text-[12px] opacity-70">domain</span>${r.domain || 'general'}</span>
        ${!r.credit_card ? '<span class="px-2 py-1 rounded-md text-[10px] font-bold uppercase bg-accent-emerald/10 text-accent-emerald border border-accent-emerald/20 flex items-center gap-1"><span class="material-symbols-outlined text-[12px]">credit_card_off</span>no cc</span>' : ''}
      </div>
      
      <div class="grid grid-cols-3 gap-2 border-t border-white/5 pt-4 relative z-10">
        <div class="text-center">
            <span class="block text-white font-bold text-sm">${parseFloat(r.rarity_score || 0).toFixed(0)}</span>
            <span class="block text-[10px] text-slate-500 uppercase">Rarity</span>
        </div>
        <div class="text-center">
            <span class="block text-white font-bold text-sm">${parseFloat(r.value_score || 0).toFixed(0)}</span>
            <span class="block text-[10px] text-slate-500 uppercase">Value</span>
        </div>
        <div class="text-center">
            <span class="block text-white font-bold text-sm">${parseFloat(r.risk_score || 0).toFixed(0)}</span>
            <span class="block text-[10px] text-slate-500 uppercase">Risk</span>
        </div>
      </div>
      
      <div class="absolute -right-10 -bottom-10 opacity-5 group-hover:opacity-10 transition-opacity">
        <span class="material-symbols-outlined text-9xl">api</span>
      </div>
    </div>
  `).join('');
}

// ── Load Sources Tab ──────────────────────────────────────
async function loadSources() {
  const container = document.getElementById('crawl-sources');
  container.innerHTML = '<div class="text-center text-slate-400 py-10">Loading...</div>';

  const data = await api('/sources');
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-500 py-10">No active sources configuration found.</div>';
    return;
  }

  container.innerHTML = data.map(s => {
    const isOk = s.is_active;
    return `
    <div class="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 mb-3">
      <div class="flex items-center gap-4">
        <div class="w-10 h-10 rounded-xl ${isOk ? 'bg-accent-emerald/20' : 'bg-red-500/20'} flex items-center justify-center">
          <span class="material-symbols-outlined ${isOk ? 'text-accent-emerald' : 'text-red-500'}">${isOk ? 'power' : 'power_off'}</span>
        </div>
        <div>
          <p class="text-sm font-bold text-white">${escapeHtml(s.name)}</p>
          <div class="flex gap-2 items-center mt-1">
             <span class="text-xs text-slate-400 uppercase">${s.source_type}</span>
             <span class="w-1 h-1 rounded-full bg-slate-600"></span>
             <span class="text-xs text-slate-400">Success: ${parseFloat(s.success_rate || 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>
      <div class="text-right">
        <span class="block text-xs text-slate-300 font-mono">${s.last_crawled ? timeAgo(s.last_crawled) : 'pending'}</span>
        <span class="block text-[10px] text-slate-500 uppercase">Last scan</span>
      </div>
    </div>
  `}).join('');
}

// ── Load Logs Tab ─────────────────────────────────────────
async function loadLogs() {
  const stats = await api('/stats');
  if (!stats) return;
  const logsContainer = document.getElementById('system-logs');

  if (stats.recent_logs && stats.recent_logs.length > 0) {
    logsContainer.innerHTML = stats.recent_logs.map(l => {
      let colorClass = 'text-slate-300';
      if (l.status === 'error') colorClass = 'text-red-400';
      if (l.status === 'success') colorClass = 'text-accent-emerald';

      return `
      <div class="flex gap-4 py-2 hover:bg-white/[0.02] -mx-4 px-4 border-b border-white/[0.02] transition-colors rounded">
        <span class="text-slate-500 w-32 shrink-0">[${timeAgo(l.created_at)}]</span>
        <span class="w-24 shrink-0 font-bold uppercase text-[10px] tracking-wider pt-0.5 text-accent-cyan">${l.module}</span>
        <span class="flex-1 ${colorClass}">${escapeHtml(l.message || l.action)}</span>
      </div>
    `}).join('');
  } else {
    logsContainer.innerHTML = '<div class="text-slate-500">No recent logs.</div>';
  }
}

// ── Tab Switching ───────────────────────────────────────
function switchTab(tabName) {
  currentTab = tabName;

  // Set active link styles in sidebar
  const tabs = ['overview', 'resources', 'sources', 'logs'];
  const activeClass = 'bg-primary/10 text-primary border-primary/20'.split(' ');
  const inactiveClass = 'hover:bg-white/5 text-slate-400 hover:text-white border-transparent border'.split(' ');

  tabs.forEach(t => {
    const el = document.getElementById(`nav-${t}`);
    const contentEl = document.getElementById(`tab-${t}`);
    if (!el || !contentEl) return;

    if (t === tabName) {
      el.classList.add(...activeClass);
      el.classList.remove(...inactiveClass);
      contentEl.classList.add('active');
    } else {
      el.classList.remove(...activeClass);
      el.classList.add(...inactiveClass);
      contentEl.classList.remove('active');
    }
  });

  // Update Title
  const titles = {
    'overview': 'Resource Overview',
    'resources': 'Discovery Database',
    'sources': 'Crawl Sources',
    'logs': 'System Telemetry'
  };
  document.getElementById('page-title').textContent = titles[tabName];

  // Load relevant data
  if (tabName === 'overview') loadOverview();
  if (tabName === 'resources') loadResources();
  if (tabName === 'sources') loadSources();
  if (tabName === 'logs') loadLogs();
}

// ── Run Pipeline ────────────────────────────────────────
async function triggerPipeline() {
  const btn = document.getElementById('btn-run');
  const ogHtml = btn.innerHTML;
  btn.innerHTML = '<span class="material-symbols-outlined text-lg animate-spin">refresh</span>... RUNNING';
  btn.disabled = true;

  try {
    await fetch(`${API}/pipeline/run`, { method: 'POST' });
    setTimeout(() => {
      btn.innerHTML = ogHtml;
      btn.disabled = false;
      loadOverview();
    }, 5000);
  } catch {
    btn.innerHTML = ogHtml;
    btn.disabled = false;
  }
}

// ── Escape HTML ─────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Health check indicator ──────────────────────────────
async function checkHealth() {
  const icon = document.getElementById('health-icon');
  const text = document.getElementById('health-text');
  try {
    const data = await api('/health');
    if (data && data.status === 'healthy') {
      icon.className = 'material-symbols-outlined text-4xl text-accent-emerald animate-pulse';
      text.textContent = 'All systems operational';
      text.className = 'text-xs text-accent-emerald';
    } else {
      throw new Error();
    }
  } catch {
    icon.className = 'material-symbols-outlined text-4xl text-red-500 animate-none';
    text.textContent = 'System degraded';
    text.className = 'text-xs text-red-500';
  }
}

// ── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  switchTab('overview');
  checkHealth();
  setInterval(checkHealth, 30000);
  setInterval(() => {
    if (currentTab === 'overview') loadOverview();
    if (currentTab === 'logs') loadLogs();
  }, 30000);
});

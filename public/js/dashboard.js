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

// ── Score class ─────────────────────────────────────────
function scoreClass(score) {
  if (score >= 60) return 'score-high';
  if (score >= 30) return 'score-medium';
  return 'score-low';
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
    topContainer.innerHTML = stats.top_resources.map(r => `
      <div class="resource-card" onclick="window.open('${r.url}', '_blank')">
        <div class="resource-header">
          <span class="resource-name">${escapeHtml(r.name)}</span>
          <div class="score-badge ${scoreClass(parseFloat(r.final_score))}">
            ${parseFloat(r.final_score).toFixed(0)}
          </div>
        </div>
        <div class="resource-tags">
          <span class="tag tag-type">${r.type || 'other'}</span>
          <span class="tag tag-domain">${r.domain || 'general'}</span>
        </div>
      </div>
    `).join('');
  } else {
    topContainer.innerHTML = '<div class="loading">System loading...</div>';
  }

  // Recent Alerts
  const alertsContainer = document.getElementById('recent-alerts');
  if (stats.recent_alerts && stats.recent_alerts.length > 0) {
    alertsContainer.innerHTML = stats.recent_alerts.map(a => `
      <div class="alert-item">
        <div class="alert-icon"></div>
        <div class="alert-content">
          <div class="alert-title">${escapeHtml(a.title)}</div>
          <div class="alert-message">${escapeHtml(a.message || '')}</div>
        </div>
        <div class="alert-time">${timeAgo(a.created_at)}</div>
      </div>
    `).join('');
  } else {
    alertsContainer.innerHTML = '<div class="loading">No alerts</div>';
  }

  // System Logs
  const logsContainer = document.getElementById('system-logs');
  if (stats.recent_logs && stats.recent_logs.length > 0) {
    logsContainer.innerHTML = stats.recent_logs.map(l => `
      <div class="log-item">
        <div class="log-status ${l.status}"></div>
        <span class="log-module">${l.module}</span>
        <span class="log-message">${escapeHtml(l.message || l.action)}</span>
        <span class="log-time">${timeAgo(l.created_at)}</span>
      </div>
    `).join('');
  } else {
    logsContainer.innerHTML = '<div class="log-item"><span class="log-message">System initializing...</span></div>';
  }
}

// ── Load Resources ──────────────────────────────────────
async function loadResources() {
  const type = document.getElementById('filter-type')?.value || '';
  const domain = document.getElementById('filter-domain')?.value || '';
  const minScore = document.getElementById('filter-score')?.value || '';

  let queryParams = '?limit=50';
  if (type) queryParams += `&type=${type}`;
  if (domain) queryParams += `&domain=${domain}`;
  if (minScore) queryParams += `&min_score=${minScore}`;

  const data = await api(`/resources${queryParams}`);
  const container = document.getElementById('all-resources');

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="loading">No resources. Run pipeline first.</div>';
    return;
  }

  const resources = Array.isArray(data) ? data : [];
  container.innerHTML = resources.map(r => `
    <div class="resource-card" onclick="window.open('${r.url}', '_blank')">
      <div class="resource-header">
        <span class="resource-name">${escapeHtml(r.name)}</span>
        <div class="score-badge ${scoreClass(parseFloat(r.final_score || 0))}">
          ${parseFloat(r.final_score || 0).toFixed(0)}
        </div>
      </div>
      <div class="resource-desc">${escapeHtml(r.description || 'No description')}</div>
      <div class="resource-tags">
        <span class="tag tag-type">${r.type || 'other'}</span>
        <span class="tag tag-domain">${r.domain || 'general'}</span>
        ${!r.credit_card ? '<span class="tag tag-free">no-cc</span>' : ''}
      </div>
      <div class="resource-meta">
        <div class="resource-scores">
          <span>Rarity: ${parseFloat(r.rarity_score || 0).toFixed(0)}</span>
          <span>Value: ${parseFloat(r.value_score || 0).toFixed(0)}</span>
          <span>Risk: ${parseFloat(r.risk_score || 0).toFixed(0)}</span>
        </div>
        <a href="${r.url}" target="_blank" class="resource-link">VIEW</a>
      </div>
    </div>
  `).join('');
}

// ── Load Sources ────────────────────────────────────────
async function loadSources() {
  const data = await api('/sources');
  const container = document.getElementById('crawl-sources');

  if (!data || data.length === 0) {
    container.innerHTML = '<div class="loading">No sources configured</div>';
    return;
  }

  container.innerHTML = data.map(s => `
    <div class="alert-item">
      <div class="alert-icon">${s.is_active ? '[ON]' : '[OFF]'}</div>
      <div class="alert-content">
        <div class="alert-title">${escapeHtml(s.name)}</div>
        <div class="alert-message">${s.source_type} · Success: ${parseFloat(s.success_rate || 100).toFixed(0)}%</div>
      </div>
      <div class="alert-time">${s.last_crawled ? timeAgo(s.last_crawled) : 'pending'}</div>
    </div>
  `).join('');
}

// ── Tab Switching ───────────────────────────────────────
function switchTab(tabName) {
  currentTab = tabName;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
  document.getElementById(`tab-${tabName}`).classList.add('active');

  if (tabName === 'overview') loadOverview();
  if (tabName === 'resources') loadResources();
  if (tabName === 'sources') loadSources();
}

// ── Run Pipeline ────────────────────────────────────────
async function triggerPipeline() {
  const btn = document.getElementById('btn-run');
  btn.textContent = '... RUNNING';
  btn.disabled = true;

  try {
    await fetch(`${API}/pipeline/run`, { method: 'POST' });
    setTimeout(() => {
      btn.textContent = '>_ RUN_PIPELINE';
      btn.disabled = false;
      loadOverview();
    }, 5000);
  } catch {
    btn.textContent = '>_ RUN_PIPELINE';
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
  try {
    const data = await api('/health');
    const dot = document.getElementById('health-dot');
    if (data && data.status === 'healthy') {
      dot.style.background = 'var(--success)';
      dot.style.boxShadow = '0 0 8px var(--success)';
    }
  } catch {
    const dot = document.getElementById('health-dot');
    dot.style.background = 'var(--danger)';
    dot.style.boxShadow = '0 0 8px var(--danger)';
  }
}

// ── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadOverview();
  checkHealth();
  setInterval(checkHealth, 30000);
  setInterval(() => { if (currentTab === 'overview') loadOverview(); }, 60000);
});

/* ══════════════════════════════════════════════════════════
   SENTINEL NEXUS — Dashboard Controller (Vanilla JS)
   Zero frameworks. Zero bloat. Pure DOM performance.
   ══════════════════════════════════════════════════════════ */

const API = window.location.origin + '/api';
const REFRESH_INTERVAL = 45000; // 45s auto-refresh

// ── DOM Cache (all getElementById calls happen ONCE) ─────
const $ = id => document.getElementById(id);
const DOM = {
    // Vitals
    vLatency: $('vLatency'), vVectors: $('vVectors'),
    vPipeline: $('vPipeline'), vUptime: $('vUptime'),
    headerBadge: $('headerBadge'),
    // Stats
    sTotal: $('sTotal'), sGems: $('sGems'),
    sAnalyzed: $('sAnalyzed'), sSources: $('sSources'),
    sTotalBar: $('sTotalBar'), sGemsBar: $('sGemsBar'),
    sAnalyzedBar: $('sAnalyzedBar'), sSourcesBar: $('sSourcesBar'),
    // Distributions
    domainDist: $('domainDist'), typeDist: $('typeDist'),
    // Tables
    topTable: $('topTable'), reconTable: $('reconTable'),
    vectorsTable: $('vectorsTable'),
    // Logs
    logsContainer: $('logsContainer'),
    // Intel
    intelViewer: $('intelViewer'),
    // Filters
    filterDomain: $('filterDomain'), filterType: $('filterType'),
    // Modal
    modalOverlay: $('modalOverlay'), modalTitle: $('modalTitle'),
    modalBody: $('modalBody'), modalClose: $('modalClose'),
    // Misc
    btnRunPipeline: $('btnRunPipeline'),
    footerClock: $('footerClock'),
    hamburger: $('hamburger'), sidebar: $('sidebar'),
    sysPulse: $('sysPulse'), sysStatusText: $('sysStatusText'),
};

// ── State ─────────────────────────────────────────────
let _resources = [];
let _stats = null;
let _sources = [];

// ── Fetch Helper (with latency tracking) ──────────────
async function apiFetch(endpoint) {
    const t0 = performance.now();
    try {
        const res = await fetch(API + endpoint);
        const json = await res.json();
        const latency = Math.round(performance.now() - t0);
        DOM.vLatency.textContent = latency + 'ms';
        DOM.vLatency.style.color = latency < 300 ? 'var(--green)' : latency < 800 ? 'var(--amber)' : 'var(--red)';
        return json;
    } catch (e) {
        DOM.vLatency.textContent = 'ERR';
        DOM.vLatency.style.color = 'var(--red)';
        console.error('[SENTINEL] Fetch error:', endpoint, e);
        return { success: false, data: null };
    }
}

// ── DOMAIN COLORS MAP ─────────────────────────────────
const DOMAIN_COLORS = {
    security: '#FF6B6B', ml: '#A78BFA', data: '#FF4060',
    devops: '#FFB800', compute: '#00E5FF', nlp: '#6BCB77',
    vision: '#4ECDC4', general: '#6E7681',
};
const DOMAIN_LABELS = {
    security: '🥷 Security', ml: '🧠 ML/IA', data: '🩸 Data',
    devops: '⚙️ DevOps', compute: '⚡ Compute', nlp: '💬 NLP',
    vision: '👁 Vision', general: '◌ General',
};

// ── Format Helpers ────────────────────────────────────
function timeAgo(dateStr) {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'Ahora';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
}

function formatUptime(seconds) {
    if (!seconds) return '--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h + 'h ' + m + 'm';
}

function scoreClass(score) {
    const n = parseFloat(score);
    if (n >= 60) return 'high';
    if (n >= 40) return 'mid';
    return 'low';
}

function latencyHTML(ms) {
    if (ms == null) return '<span style="color:var(--text-dim)">--</span>';
    const num = parseInt(ms);
    let color = 'var(--text-bright)';
    let badge = '';
    if (num < 100) { color = 'var(--green)'; badge = ' ⚡'; }
    else if (num < 300) color = 'var(--amber)';
    else color = 'var(--red)';
    return `<span style="color:${color}">${num}ms${badge}</span>`;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── RENDER: Stats Cards ───────────────────────────────
function renderStats(stats) {
    const total = stats.total_resources || 0;
    const topResources = stats.top_resources || [];
    const gems = topResources.filter(r => parseFloat(r.final_score) >= 60).length;
    const byType = stats.by_type || [];
    const analyzedCount = topResources.filter(r => r.final_score).length;

    DOM.sTotal.textContent = total.toLocaleString();
    DOM.sGems.textContent = gems;
    DOM.sAnalyzed.textContent = analyzedCount;
    DOM.sSources.textContent = _sources.filter(s => s.is_active).length;

    // Bars (percentage of max)
    DOM.sTotalBar.style.width = Math.min(100, (total / 1000) * 100) + '%';
    DOM.sGemsBar.style.width = Math.min(100, (gems / 20) * 100) + '%';
    DOM.sAnalyzedBar.style.width = Math.min(100, (analyzedCount / 10) * 100) + '%';
    DOM.sSourcesBar.style.width = Math.min(100, (_sources.length / 20) * 100) + '%';
}

// ── RENDER: Distribution Bars ─────────────────────────
function renderDistribution(container, data, colorMap) {
    if (!data || data.length === 0) {
        container.innerHTML = '<span style="color:var(--text-dim);font-size:12px">Sin datos</span>';
        return;
    }
    const maxCount = Math.max(...data.map(d => parseInt(d.count)));
    const fragment = document.createDocumentFragment();

    data.forEach(item => {
        const key = item.domain || item.type || 'general';
        const color = colorMap[key] || 'var(--text-dim)';
        const pct = maxCount > 0 ? (parseInt(item.count) / maxCount * 100) : 0;
        const label = DOMAIN_LABELS[key] || key;

        const row = document.createElement('div');
        row.className = 'dist-row';
        row.innerHTML =
            `<span class="dist-label">${escapeHtml(label)}</span>` +
            `<div class="dist-bar-bg"><div class="dist-bar-val" style="width:${pct}%;background:${color}"></div></div>` +
            `<span class="dist-count">${item.count}</span>`;
        fragment.appendChild(row);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

// ── RENDER: Top Resources Table ───────────────────────
function renderTopTable(resources) {
    const fragment = document.createDocumentFragment();

    resources.forEach((r, i) => {
        const tr = document.createElement('tr');
        const sc = scoreClass(r.final_score);
        const domain = r.domain || 'general';
        tr.innerHTML =
            `<td class="mono">${i + 1}</td>` +
            `<td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" style="color:var(--text-bright);text-decoration:none">${escapeHtml(r.name)}</a></td>` +
            `<td><span class="domain-tag ${domain}">${escapeHtml(DOMAIN_LABELS[domain] || domain)}</span></td>` +
            `<td class="mono">${escapeHtml(r.type || '--')}</td>` +
            `<td class="mono">${latencyHTML(r.latency_ms)}</td>` +
            `<td><span class="score ${sc}">${parseFloat(r.final_score || 0).toFixed(1)}</span></td>`;
        fragment.appendChild(tr);
    });

    DOM.topTable.innerHTML = '';
    DOM.topTable.appendChild(fragment);
}

// ── RENDER: Recon Table (Full Resources) ──────────────
function renderReconTable(resources) {
    const fragment = document.createDocumentFragment();

    resources.forEach(r => {
        const tr = document.createElement('tr');
        const sc = scoreClass(r.final_score);
        const domain = r.domain || 'general';
        const hasIntel = r.tech_summary && r.tech_summary.length > 10;
        tr.innerHTML =
            `<td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" style="color:var(--text-bright);text-decoration:none">${escapeHtml(r.name)}</a></td>` +
            `<td><span class="domain-tag ${domain}">${escapeHtml(DOMAIN_LABELS[domain] || domain)}</span></td>` +
            `<td class="mono">${escapeHtml(r.type || '--')}</td>` +
            `<td class="mono">${parseFloat(r.rarity_score || 0).toFixed(0)}</td>` +
            `<td class="mono">${latencyHTML(r.latency_ms)}</td>` +
            `<td><span class="score ${sc}">${parseFloat(r.final_score || 0).toFixed(1)}</span></td>` +
            `<td>${hasIntel ? '<button class="btn-view" data-id="' + r.id + '">VER</button>' : '<span style="color:var(--text-dim)">—</span>'}</td>`;
        fragment.appendChild(tr);
    });

    DOM.reconTable.innerHTML = '';
    DOM.reconTable.appendChild(fragment);
}

// ── RENDER: Vectors (Sources) ─────────────────────────
function renderVectors(sources) {
    const fragment = document.createDocumentFragment();

    sources.forEach(s => {
        const tr = document.createElement('tr');
        const active = s.is_active;
        tr.innerHTML =
            `<td>${escapeHtml(s.name)}</td>` +
            `<td class="mono">${escapeHtml(s.source_type || '--')}</td>` +
            `<td style="color:${active ? 'var(--green)' : 'var(--red)'}">${active ? '● ACTIVO' : '○ INACTIVO'}</td>` +
            `<td class="mono">${timeAgo(s.last_crawled)}</td>` +
            `<td class="mono">${s.success_rate != null ? s.success_rate + '%' : '--'}</td>`;
        fragment.appendChild(tr);
    });

    DOM.vectorsTable.innerHTML = '';
    DOM.vectorsTable.appendChild(fragment);
}

// ── RENDER: Logs ──────────────────────────────────────
function renderLogs(logs) {
    const fragment = document.createDocumentFragment();

    logs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'log-entry';
        const t = new Date(log.created_at);
        const time = t.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        div.innerHTML =
            `<span class="log-time">${time}</span>` +
            `<span class="log-module ${log.module}">${escapeHtml(log.module)}</span>` +
            `<span class="log-status ${log.status}">${log.status}</span>` +
            `<span class="log-msg">${escapeHtml(log.message)}</span>`;
        fragment.appendChild(div);
    });

    DOM.logsContainer.innerHTML = '';
    DOM.logsContainer.appendChild(fragment);
}

// ── MODAL ─────────────────────────────────────────────
function openModal(title, body) {
    DOM.modalTitle.textContent = title;
    DOM.modalBody.textContent = body;
    DOM.modalOverlay.classList.add('open');
}
function closeModal() {
    DOM.modalOverlay.classList.remove('open');
}

// ── LOAD ALL DATA ─────────────────────────────────────
async function loadAll() {
    // Parallel fetch all endpoints
    const [statsRes, resourcesRes, sourcesRes, healthRes] = await Promise.all([
        apiFetch('/stats'),
        apiFetch('/resources?limit=100'),
        apiFetch('/sources'),
        apiFetch('/health'),
    ]);

    // Stats
    if (statsRes.success) {
        _stats = statsRes.data;
        renderStats(_stats);
        renderDistribution(DOM.domainDist, _stats.by_domain, DOMAIN_COLORS);

        const TYPE_COLORS = {
            api: '#00E5FF', tool: '#A78BFA', database: '#FF4060',
            compute: '#FFB800', vps: '#6BCB77', storage: '#4ECDC4', other: '#6E7681',
        };
        renderDistribution(DOM.typeDist, _stats.by_type, TYPE_COLORS);
        renderTopTable(_stats.top_resources || []);
        renderLogs(_stats.recent_logs || []);

        // Pipeline vital
        const lastPipeline = (_stats.recent_logs || []).find(l => l.module === 'scheduler');
        if (lastPipeline && lastPipeline.metadata) {
            const dur = lastPipeline.metadata.duration_seconds;
            DOM.vPipeline.textContent = dur ? dur.toFixed(0) + 's' : 'OK';
        } else {
            DOM.vPipeline.textContent = 'OK';
        }
    }

    // Resources
    if (resourcesRes.success) {
        _resources = resourcesRes.data || [];
        applyFiltersAndRender();

        // Update analyzed count
        const analyzed = _resources.filter(r => r.tech_summary && r.tech_summary.length > 10).length;
        DOM.sAnalyzed.textContent = analyzed;
        DOM.sAnalyzedBar.style.width = Math.min(100, (analyzed / Math.max(_resources.length, 1)) * 100) + '%';

        // Gems count
        const gems = _resources.filter(r => parseFloat(r.final_score) >= 60).length;
        DOM.sGems.textContent = gems;
        DOM.sGemsBar.style.width = Math.min(100, (gems / 20) * 100) + '%';

        // Show latest AI report in Intel tab
        const withIntel = _resources.filter(r => r.tech_summary && r.tech_summary.length > 10);
        if (withIntel.length > 0) {
            const latest = withIntel[0]; // highest score first
            DOM.intelViewer.textContent = `═══ ${latest.name} ═══\nURL: ${latest.url}\nScore: ${latest.final_score}/100\n\n${latest.tech_summary}`;
            DOM.intelViewer.classList.remove('intel-placeholder');
        }
    }

    // Sources
    if (sourcesRes.success) {
        _sources = sourcesRes.data || [];
        renderVectors(_sources);
        const active = _sources.filter(s => s.is_active).length;
        DOM.vVectors.textContent = active + '/' + _sources.length;
        DOM.sSources.textContent = active;
        DOM.sSourcesBar.style.width = Math.min(100, (active / Math.max(_sources.length, 1)) * 100) + '%';
    }

    // Health
    if (healthRes.success) {
        DOM.vUptime.textContent = formatUptime(healthRes.uptime_seconds);
        DOM.headerBadge.textContent = 'OPERATIVO';
        DOM.headerBadge.style.color = 'var(--green)';
        DOM.headerBadge.style.borderColor = 'var(--green)';
        DOM.sysPulse.style.color = 'var(--green)';
        DOM.sysStatusText.textContent = 'ONLINE';
    } else {
        DOM.headerBadge.textContent = 'OFFLINE';
        DOM.headerBadge.style.color = 'var(--red)';
        DOM.headerBadge.style.borderColor = 'var(--red)';
        DOM.sysPulse.style.color = 'var(--red)';
        DOM.sysStatusText.textContent = 'OFFLINE';
    }
}

// ── Filter Resources ──────────────────────────────────
function applyFiltersAndRender() {
    const domainFilter = DOM.filterDomain.value;
    const typeFilter = DOM.filterType.value;

    let filtered = _resources;
    if (domainFilter) filtered = filtered.filter(r => r.domain === domainFilter);
    if (typeFilter) filtered = filtered.filter(r => r.type === typeFilter);

    renderReconTable(filtered);
}

// ── TAB NAVIGATION ────────────────────────────────────
function initTabs() {
    const navItems = document.querySelectorAll('.nav-item[data-tab]');
    const tabs = document.querySelectorAll('.tab-content');

    navItems.forEach(item => {
        item.addEventListener('click', e => {
            e.preventDefault();
            const target = item.getAttribute('data-tab');

            navItems.forEach(n => n.classList.remove('active'));
            tabs.forEach(t => t.classList.remove('active'));

            item.classList.add('active');
            const tabEl = document.getElementById('tab-' + target);
            if (tabEl) tabEl.classList.add('active');

            // Close sidebar on mobile
            DOM.sidebar.classList.remove('open');
        });
    });
}

// ── CLOCK ─────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    DOM.footerClock.textContent = now.toLocaleTimeString('es', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}

// ── EVENTS ────────────────────────────────────────────
function initEvents() {
    // Hamburger
    DOM.hamburger.addEventListener('click', () => {
        DOM.sidebar.classList.toggle('open');
    });

    // Modal close
    DOM.modalClose.addEventListener('click', closeModal);
    DOM.modalOverlay.addEventListener('click', e => {
        if (e.target === DOM.modalOverlay) closeModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });

    // Pipeline button
    DOM.btnRunPipeline.addEventListener('click', async () => {
        DOM.btnRunPipeline.disabled = true;
        DOM.btnRunPipeline.textContent = '⏳ EJECUTANDO...';
        try {
            await fetch(API + '/pipeline/run', { method: 'POST' });
            DOM.btnRunPipeline.textContent = '✅ INICIADO';
            setTimeout(() => {
                DOM.btnRunPipeline.textContent = '▶ RUN PIPELINE';
                DOM.btnRunPipeline.disabled = false;
                loadAll();
            }, 5000);
        } catch (e) {
            DOM.btnRunPipeline.textContent = '❌ ERROR';
            setTimeout(() => {
                DOM.btnRunPipeline.textContent = '▶ RUN PIPELINE';
                DOM.btnRunPipeline.disabled = false;
            }, 3000);
        }
    });

    // Filters
    DOM.filterDomain.addEventListener('change', applyFiltersAndRender);
    DOM.filterType.addEventListener('change', applyFiltersAndRender);

    // Delegate: Recon table VIEW buttons
    DOM.reconTable.addEventListener('click', e => {
        const btn = e.target.closest('.btn-view');
        if (!btn) return;
        const id = parseInt(btn.getAttribute('data-id'));
        const resource = _resources.find(r => r.id === id);
        if (resource && resource.tech_summary) {
            openModal(resource.name, resource.tech_summary);
        }
    });
}

// ── INIT ──────────────────────────────────────────────
(async function init() {
    initTabs();
    initEvents();
    updateClock();
    setInterval(updateClock, 1000);

    // Initial load
    await loadAll();

    // Auto refresh
    setInterval(loadAll, REFRESH_INTERVAL);
})();

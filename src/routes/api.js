const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { runPipeline } = require('../modules/scheduler');
const { sendDailySummary } = require('../modules/telegram');

// Simple Memory Cache to drastically improve API and DB performance
const _cache = {};
const CACHE_TTL = 60000; // 60 segundos //

// Helper to use cache
async function getCached(key, fetcher) {
    if (_cache[key] && (Date.now() - _cache[key].timestamp < CACHE_TTL)) {
        return _cache[key].data;
    }
    const data = await fetcher();
    _cache[key] = { data, timestamp: Date.now() };
    return data;
}

// ── POST /api/telegram/summary – Enviar resumen por Telegram ──
router.post('/telegram/summary', async (req, res) => {
    try {
        res.json({ success: true, message: 'Resumen enviado a Telegram' });
        sendDailySummary();
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/resources – Listar recursos ────────────────
router.get('/resources', async (req, res) => {
    try {
        const { type = '', domain = '', min_score = '', limit = '50' } = req.query;
        const cacheKey = `resources_${type}_${domain}_${min_score}_${limit}`;

        const data = await getCached(cacheKey, async () => {
            let query = `SELECT id, name, url, type, domain, rarity_score, value_score, final_score, tech_summary, latency_ms FROM resources WHERE 1=1`;
            const params = [];
            let paramIndex = 1;

            if (type) { query += ` AND type = $${paramIndex++}`; params.push(type); }
            if (domain) { query += ` AND domain = $${paramIndex++}`; params.push(domain); }
            if (min_score) { query += ` AND final_score >= $${paramIndex++}`; params.push(parseFloat(min_score)); }

            query += ` ORDER BY final_score DESC LIMIT $${paramIndex++}`;
            params.push(parseInt(limit) || 50);

            const { rows } = await pool.query(query, params);
            return rows;
        });

        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/stats – Estadísticas del sistema ───────────
router.get('/stats', async (req, res) => {
    try {
        const data = await getCached('stats', async () => {
            const [totalRes, byType, byStatus, byDomain, topScored, recentAlerts, recentLogs] = await Promise.all([
                pool.query('SELECT COUNT(*) as total FROM resources'),
                pool.query('SELECT type, COUNT(*) as count FROM resources GROUP BY type ORDER BY count DESC'),
                pool.query('SELECT status, COUNT(*) as count FROM resources GROUP BY status ORDER BY count DESC'),
                pool.query('SELECT domain, COUNT(*) as count FROM resources GROUP BY domain ORDER BY count DESC'),
                pool.query('SELECT name, url, final_score, type, domain, latency_ms FROM resources ORDER BY final_score DESC LIMIT 10'),
                pool.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 10'),
                pool.query('SELECT * FROM system_log ORDER BY created_at DESC LIMIT 20'),
            ]);

            return {
                total_resources: parseInt(totalRes.rows[0].total),
                by_type: byType.rows,
                by_status: byStatus.rows,
                by_domain: byDomain.rows,
                top_resources: topScored.rows,
                recent_alerts: recentAlerts.rows,
                recent_logs: recentLogs.rows,
            };
        });

        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/sources – Fuentes de crawling ──────────────
router.get('/sources', async (req, res) => {
    try {
        const data = await getCached('sources', async () => {
            const { rows } = await pool.query('SELECT * FROM crawl_sources ORDER BY last_crawled DESC NULLS LAST');
            return rows;
        });
        res.json({ success: true, data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/health – Salud del sistema ─────────────────
router.get('/health', async (req, res) => {
    try {
        // Reduced to minimal queries for health endpoint to save latency
        const dbCheck = await pool.query('SELECT 1');

        res.json({
            success: true,
            status: 'healthy',
            database: 'connected',
            uptime_seconds: Math.floor(process.uptime()),
        });
    } catch (err) {
        res.status(500).json({ success: false, status: 'unhealthy', error: err.message });
    }
});

// ── POST /api/pipeline/run – Ejecutar pipeline manualmente ──
router.post('/pipeline/run', async (req, res) => {
    // Limpiamos la caché cuando corre el pipeline para que los datos sean frescos
    Object.keys(_cache).forEach(k => delete _cache[k]);
    try {
        res.json({ success: true, message: 'Pipeline iniciado en background' });
        runPipeline(); // No esperamos a que termine
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

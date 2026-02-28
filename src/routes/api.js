const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { runPipeline } = require('../modules/scheduler');

// ── GET /api/resources – Listar recursos ────────────────
router.get('/resources', async (req, res) => {
    try {
        const { type, domain, status, sort, limit, offset, min_score } = req.query;

        let query = `SELECT * FROM resources WHERE 1=1`;
        const params = [];
        let paramIndex = 1;

        if (type) { query += ` AND type = $${paramIndex++}`; params.push(type); }
        if (domain) { query += ` AND domain = $${paramIndex++}`; params.push(domain); }
        if (status) { query += ` AND status = $${paramIndex++}`; params.push(status); }
        if (min_score) { query += ` AND final_score >= $${paramIndex++}`; params.push(parseFloat(min_score)); }

        const sortField = sort === 'rarity' ? 'rarity_score' : sort === 'value' ? 'value_score' : 'final_score';
        query += ` ORDER BY ${sortField} DESC`;
        query += ` LIMIT $${paramIndex++}`;
        params.push(parseInt(limit) || 50);
        query += ` OFFSET $${paramIndex++}`;
        params.push(parseInt(offset) || 0);

        const { rows } = await pool.query(query, params);

        const { rows: countRows } = await pool.query('SELECT COUNT(*) FROM resources');

        res.json({
            success: true,
            total: parseInt(countRows[0].count),
            data: rows,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/resources/:id – Detalle de recurso ─────────
router.get('/resources/:id', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM resources WHERE id = $1', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'No encontrado' });

        const { rows: history } = await pool.query(
            'SELECT * FROM resource_history WHERE resource_id = $1 ORDER BY changed_at DESC LIMIT 20',
            [req.params.id]
        );

        res.json({ success: true, data: { ...rows[0], history } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/stats – Estadísticas del sistema ───────────
router.get('/stats', async (req, res) => {
    try {
        const [totalRes, byType, byStatus, byDomain, topScored, recentAlerts, recentLogs] = await Promise.all([
            pool.query('SELECT COUNT(*) as total FROM resources'),
            pool.query('SELECT type, COUNT(*) as count FROM resources GROUP BY type ORDER BY count DESC'),
            pool.query('SELECT status, COUNT(*) as count FROM resources GROUP BY status ORDER BY count DESC'),
            pool.query('SELECT domain, COUNT(*) as count FROM resources GROUP BY domain ORDER BY count DESC'),
            pool.query('SELECT name, url, final_score, type, domain FROM resources ORDER BY final_score DESC LIMIT 10'),
            pool.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 10'),
            pool.query('SELECT * FROM system_log ORDER BY created_at DESC LIMIT 20'),
        ]);

        res.json({
            success: true,
            data: {
                total_resources: parseInt(totalRes.rows[0].total),
                by_type: byType.rows,
                by_status: byStatus.rows,
                by_domain: byDomain.rows,
                top_resources: topScored.rows,
                recent_alerts: recentAlerts.rows,
                recent_logs: recentLogs.rows,
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/alerts – Alertas ───────────────────────────
router.get('/alerts', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT a.*, r.name as resource_name, r.url as resource_url FROM alerts a LEFT JOIN resources r ON a.resource_id = r.id ORDER BY a.created_at DESC LIMIT 50'
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/sources – Fuentes de crawling ──────────────
router.get('/sources', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM crawl_sources ORDER BY last_crawled DESC NULLS LAST');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/sources – Agregar fuente de crawling ──────
router.post('/sources', async (req, res) => {
    try {
        const { name, url, source_type } = req.body;
        if (!name || !url) return res.status(400).json({ success: false, error: 'name y url son requeridos' });

        const { rows } = await pool.query(
            `INSERT INTO crawl_sources (name, url, source_type) VALUES ($1, $2, $3) RETURNING *`,
            [name, url, source_type || 'web']
        );
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/pipeline/run – Ejecutar pipeline manualmente ──
router.post('/pipeline/run', async (req, res) => {
    try {
        res.json({ success: true, message: 'Pipeline iniciado en background' });
        runPipeline(); // No esperamos a que termine
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /api/health – Salud del sistema ─────────────────
router.get('/health', async (req, res) => {
    try {
        const dbCheck = await pool.query('SELECT NOW()');
        const { rows: logRows } = await pool.query(
            `SELECT * FROM system_log WHERE module = 'scheduler' ORDER BY created_at DESC LIMIT 1`
        );

        res.json({
            success: true,
            status: 'healthy',
            database: 'connected',
            server_time: dbCheck.rows[0].now,
            last_pipeline: logRows[0] || null,
            uptime_seconds: Math.floor(process.uptime()),
        });
    } catch (err) {
        res.status(500).json({ success: false, status: 'unhealthy', error: err.message });
    }
});

module.exports = router;

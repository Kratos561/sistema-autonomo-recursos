const cron = require('node-cron');
const { runAllCrawlers } = require('../crawlers/engine');
const { normalizeResources } = require('./normalizer');
const { evaluateResources } = require('./scorer');
const { sendPipelineComplete, sendVIPAlert, sendDailySummary } = require('./telegram');
const pool = require('../db/pool');

let isRunning = false;

// ── Pipeline completo: Crawl → Normalize → Score ────────
async function runPipeline() {
    if (isRunning) {
        console.log('[Scheduler] ⚠️ Pipeline ya en ejecución, saltando...');
        return;
    }

    isRunning = true;
    const startTime = Date.now();
    console.log('\n══════════════════════════════════════════════');
    console.log('[Scheduler] 🚀 Iniciando pipeline completo...');
    console.log('══════════════════════════════════════════════\n');

    try {
        // Paso 1: Crawling
        console.log('[Pipeline] 📡 Paso 1/3: Recolección...');
        const crawled = await runAllCrawlers();

        // Paso 2: Normalización
        console.log('[Pipeline] 🧹 Paso 2/3: Normalización...');
        const normalized = await normalizeResources();

        // Paso 3: Scoring
        console.log('[Pipeline] 📊 Paso 3/3: Evaluación...');
        const scored = await evaluateResources();

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        // Contar recursos VIP encontrados
        const vipResult = await pool.query(
            `SELECT COUNT(*) as count FROM resources WHERE final_score >= 60`
        );
        const vipCount = parseInt(vipResult.rows[0].count);

        console.log('\n══════════════════════════════════════════════');
        console.log(`[Pipeline] ✅ Completado en ${duration}s`);
        console.log(`  → Recursos recolectados: ${crawled}`);
        console.log(`  → Recursos normalizados: ${normalized}`);
        console.log(`  → Recursos evaluados:    ${scored}`);
        console.log(`  → Recursos VIP (≥60):    ${vipCount}`);
        console.log('══════════════════════════════════════════════\n');

        await pool.query(
            `INSERT INTO system_log (module, action, status, message, metadata)
       VALUES ('scheduler', 'pipeline', 'success', $1, $2)`,
            [
                `Pipeline completado en ${duration}s`,
                JSON.stringify({ crawled, normalized, scored, vip: vipCount, duration_seconds: parseFloat(duration) })
            ]
        );

        // ── Enviar notificaciones Telegram ──
        try {
            // Notificar que el pipeline terminó
            await sendPipelineComplete({ crawled, normalized, scored, vip: vipCount });

            // Si hay recursos VIP nuevos, enviar alertas individuales
            const newVIPs = await pool.query(
                `SELECT name, url, type, domain, status, description, free_tier,
                        rarity_score, value_score, risk_score, final_score
                 FROM resources 
                 WHERE final_score >= 60 
                   AND discovered_at > NOW() - INTERVAL '2 hours'
                 ORDER BY final_score DESC
                 LIMIT 5`
            );

            for (const vip of newVIPs.rows) {
                await sendVIPAlert(vip);
                await new Promise(r => setTimeout(r, 1000));
            }

            console.log('[Telegram] ✅ Notificaciones enviadas');
        } catch (telegramErr) {
            console.error('[Telegram] ⚠️ Error enviando notificaciones:', telegramErr.message);
        }
    } catch (err) {
        console.error('[Pipeline] ❌ Error:', err.message);
        await pool.query(
            `INSERT INTO system_log (module, action, status, message)
       VALUES ('scheduler', 'pipeline', 'error', $1)`,
            [err.message]
        );
    } finally {
        isRunning = false;
    }
}

// ── Iniciar scheduler con cron ──────────────────────────
function startScheduler() {
    const intervalMinutes = parseInt(process.env.CRAWL_INTERVAL_MINUTES) || 60;

    console.log(`[Scheduler] ⏰ Programado cada ${intervalMinutes} minutos`);

    // Ejecutar pipeline según intervalo configurado
    cron.schedule(`*/${intervalMinutes} * * * *`, () => {
        console.log(`[Scheduler] ⏰ Ejecución programada (cada ${intervalMinutes} min)`);
        runPipeline();
    });

    // Ejecutar primera iteración al iniciar (con delay de 30s para dejar que el server arranque)
    setTimeout(() => {
        console.log('[Scheduler] 🏁 Ejecutando primera iteración...');
        runPipeline();
    }, 30000);
}

module.exports = { startScheduler, runPipeline };

const cron = require('node-cron');
const { runAllCrawlers } = require('../crawlers/engine');
const { normalizeResources } = require('./normalizer');
const { evaluateResources } = require('./scorer');
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

        console.log('\n══════════════════════════════════════════════');
        console.log(`[Pipeline] ✅ Completado en ${duration}s`);
        console.log(`  → Recursos recolectados: ${crawled}`);
        console.log(`  → Recursos normalizados: ${normalized}`);
        console.log(`  → Recursos evaluados:    ${scored}`);
        console.log('══════════════════════════════════════════════\n');

        await pool.query(
            `INSERT INTO system_log (module, action, status, message, metadata)
       VALUES ('scheduler', 'pipeline', 'success', $1, $2)`,
            [
                `Pipeline completado en ${duration}s`,
                JSON.stringify({ crawled, normalized, scored, duration_seconds: parseFloat(duration) })
            ]
        );
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

const cron = require('node-cron');
const crypto = require('crypto');
const { runAllCrawlers } = require('../crawlers/engine');
const { normalizeResources } = require('./normalizer');
const { evaluateResources } = require('./scorer');
const { analyzeNewResources } = require('./analyzer');
const { sendPipelineComplete, sendVIPAlert, sendDailySummary, sendMessage } = require('./telegram');
const { runProfiler } = require('./profiler');
const pool = require('../db/pool');

let isRunning = false;

// ── Generar hash de un recurso para detectar cambios ─────
function generateResourceHash(resource) {
    const data = `${resource.name}|${resource.type}|${resource.domain}|${resource.final_score}|${resource.status}|${resource.free_tier || ''}`;
    return crypto.createHash('md5').update(data).digest('hex');
}

// ── Pipeline completo: Crawl → Normalize → Score → AI ────
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
        console.log('[Pipeline] 📡 Paso 1/4: Recolección...');
        const crawled = await runAllCrawlers();

        // Paso 2: Normalización
        console.log('[Pipeline] 🧹 Paso 2/4: Normalización...');
        const normalized = await normalizeResources();

        // Paso 3: Scoring
        console.log('[Pipeline] 📊 Paso 3/4: Evaluación...');
        const scored = await evaluateResources();

        // Paso 3.5: Profiling de Latencia HFT
        console.log('[Pipeline] ⚡ Paso 3.5/5: Profiling de Latencia HFT...');
        const profiledCount = await runProfiler();

        // Paso 4: Análisis con IA
        console.log('[Pipeline] 🧠 Paso 4/5: Análisis con IA...');
        const { analyzed, report: aiReport } = await analyzeNewResources();

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);

        // Contar recursos VIP
        const vipResult = await pool.query(
            `SELECT COUNT(*) as count FROM resources WHERE final_score >= 60`
        );
        const vipCount = parseInt(vipResult.rows[0].count);

        console.log('\n══════════════════════════════════════════════');
        console.log(`[Pipeline] ✅ Completado en ${duration}s`);
        console.log(`  → Recursos recolectados: ${crawled}`);
        console.log(`  → Recursos normalizados: ${normalized}`);
        console.log(`  → Recursos evaluados:    ${scored}`);
        console.log(`  → Analizados con IA:     ${analyzed}`);
        console.log(`  → Recursos VIP (≥60):    ${vipCount}`);
        console.log('══════════════════════════════════════════════\n');

        await pool.query(
            `INSERT INTO system_log (module, action, status, message, metadata)
       VALUES ('scheduler', 'pipeline', 'success', $1, $2)`,
            [
                `Pipeline completado en ${duration}s`,
                JSON.stringify({ crawled, normalized, scored, analyzed, vip: vipCount, duration_seconds: parseFloat(duration) })
            ]
        );

        // ── Enviar notificaciones Telegram (ANTI-DUPLICADOS) ──
        try {
            // Notificar que el pipeline terminó
            await sendPipelineComplete({ crawled, normalized, scored, analyzed, vip: vipCount });

            // Buscar recursos que NO han sido notificados O que cambiaron desde la última notificación
            const newVIPs = await pool.query(`
                SELECT id, name, url, type, domain, status, description, free_tier,
                       tech_summary, rarity_score, value_score, risk_score, final_score,
                       notification_hash
                FROM resources 
                WHERE final_score > 0
                  AND (
                    telegram_notified_at IS NULL
                    OR (updated_at > telegram_notified_at AND last_changed > telegram_notified_at)
                  )
                ORDER BY final_score DESC
                LIMIT 10
            `);

            let notifiedCount = 0;
            for (const resource of newVIPs.rows) {
                // Generar hash actual del recurso
                const currentHash = generateResourceHash(resource);

                // Si ya fue notificado con el mismo hash, saltar (anti-duplicado)
                if (resource.notification_hash === currentHash) {
                    console.log(`[Telegram] ⏭️ Saltando (sin cambios): ${resource.name}`);
                    continue;
                }

                // Construir mensaje con informe de IA si existe
                let message = `🚨 <b>RECURSO DESCUBIERTO</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n`;

                const scoreEmoji = resource.final_score >= 80 ? '💎' :
                    resource.final_score >= 60 ? '🔥' :
                        resource.final_score >= 40 ? '⭐' : '📌';

                message += `${scoreEmoji} <b>${resource.name}</b>\n`;
                message += `📊 Score: <b>${resource.final_score}/100</b>\n`;
                message += `🏷️ ${resource.type || 'otro'} | ${resource.domain || 'general'}\n`;
                message += `🔗 <a href="${resource.url}">${resource.url}</a>\n`;

                // Si hay análisis de IA, agregarlo
                if (resource.tech_summary) {
                    message += `\n🧠 <b>Informe IA:</b>\n`;
                    // Limpiar markdown para HTML de Telegram
                    const cleanSummary = resource.tech_summary
                        .replace(/\*\*/g, '')
                        .replace(/\*/g, '')
                        .replace(/#{1,3}\s/g, '')
                        .substring(0, 800);
                    message += cleanSummary;
                }

                // Si fue re-descubierto (tenía notificación previa), indicarlo
                if (resource.notification_hash && resource.notification_hash !== currentHash) {
                    message += `\n\n🔄 <i>Actualización: Este recurso cambió desde la última vez.</i>`;
                }

                await sendMessage(message);
                notifiedCount++;

                // Marcar como notificado con su hash actual
                await pool.query(
                    `UPDATE resources SET telegram_notified_at = NOW(), notification_hash = $1 WHERE id = $2`,
                    [currentHash, resource.id]
                );

                // Pausa para rate limits de Telegram
                await new Promise(r => setTimeout(r, 1500));
            }

            // Enviar informe batch de IA si existe
            if (aiReport) {
                const reportMsg = `🧠 <b>INFORME DE INTELIGENCIA ARTIFICIAL</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n${aiReport.replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,3}\s/g, '').substring(0, 3500)}`;
                await sendMessage(reportMsg);
            }

            console.log(`[Telegram] ✅ ${notifiedCount} notificaciones enviadas (${newVIPs.rows.length - notifiedCount} duplicados saltados)`);
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

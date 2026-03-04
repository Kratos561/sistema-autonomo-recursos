// ============================================
// Módulo de Notificaciones Telegram
// Envía recursos VIP descubiertos al chat privado
// ============================================

const https = require('https');
const pool = require('../db/pool');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8496796648:AAH8bEdD46hUYjqmdzt6l389WLtKPU2Zt04';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '6702262011';

// ── Enviar mensaje a Telegram ─────────────────────────
function sendMessage(text, parseMode = 'HTML') {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: parseMode,
            disable_web_page_preview: true,
        });

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.ok) {
                        resolve(parsed.result);
                    } else {
                        console.error('[Telegram] Error:', parsed.description);
                        reject(new Error(parsed.description));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ── Formatear recurso como mensaje bonito ─────────────
function formatResourceMessage(resource) {
    const scoreEmoji = resource.final_score >= 80 ? '💎' :
        resource.final_score >= 60 ? '🔥' :
            resource.final_score >= 40 ? '⭐' : '📌';

    const typeEmoji = {
        'api': '🔌', 'database': '🗄️', 'vps': '🖥️',
        'compute': '⚡', 'storage': '💾', 'tool': '🔧', 'other': '📦'
    };

    const statusEmoji = {
        'active': '🟢', 'degraded': '🟡', 'dead': '🔴', 'unknown': '⚪'
    };

    const cleanDesc = resource.description ? resource.description.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').substring(0, 200) : '';
    const cleanFreeTier = resource.free_tier ? resource.free_tier.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').substring(0, 150) : '';

    return `${scoreEmoji} <b>${resource.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b>

${statusEmoji[resource.status] || '⚪'} Estado: ${resource.status || 'unknown'}
📊 Score: <b>${resource.final_score}/100</b>
├ Rareza: ${resource.rarity_score}
├ Valor: ${resource.value_score}
└ Riesgo: ${resource.risk_score}

${typeEmoji[resource.type] || '📦'} Tipo: ${resource.type || 'other'}
🏷️ Dominio: ${resource.domain || 'general'}

${resource.description ? `📝 ${cleanDesc}${resource.description.length > 200 ? '...' : ''}\n` : ''}${resource.free_tier ? `🆓 Free Tier: ${cleanFreeTier}\n` : ''}
🔗 <a href="${resource.url}">${resource.url}</a>`;
}

// ── Enviar resumen diario ─────────────────────────────
async function sendDailySummary() {
    try {
        // Obtener stats generales
        const statsResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE final_score >= 60) as vip,
        COUNT(*) FILTER (WHERE discovered_at > NOW() - INTERVAL '24 hours') as new_today,
        COALESCE(AVG(final_score), 0) as avg_score
      FROM resources
    `);
        const stats = statsResult.rows[0];

        // Obtener top 5 recursos VIP
        const topResult = await pool.query(`
      SELECT name, url, type, domain, status, 
             rarity_score, value_score, risk_score, final_score,
             description, free_tier
      FROM resources 
      WHERE final_score > 0
      ORDER BY final_score DESC 
      LIMIT 5
    `);

        const now = new Date().toLocaleString('es-ES', { timeZone: 'America/Caracas' });

        let message = `🛰️ <b>RADAR DE RECURSOS — Reporte</b>\n`;
        message += `📅 ${now}\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        message += `📊 <b>Estadísticas Generales</b>\n`;
        message += `├ Total descubiertos: <b>${stats.total}</b>\n`;
        message += `├ Recursos VIP (≥60): <b>${stats.vip}</b>\n`;
        message += `├ Nuevos hoy: <b>${stats.new_today}</b>\n`;
        message += `└ Score promedio: <b>${parseFloat(stats.avg_score).toFixed(1)}</b>\n`;

        if (topResult.rows.length > 0) {
            message += `\n🏆 <b>Top Recursos Descubiertos</b>\n`;
            message += `━━━━━━━━━━━━━━━━━━━━━━\n`;
        }

        await sendMessage(message);

        // Enviar cada recurso VIP como mensaje individual
        for (const resource of topResult.rows) {
            const resourceMsg = formatResourceMessage(resource);
            await sendMessage(resourceMsg);
            // Pequeña pausa para no exceder rate limits
            await new Promise(r => setTimeout(r, 500));
        }

        if (topResult.rows.length === 0) {
            await sendMessage('ℹ️ Aún no hay recursos con score calculado. El pipeline está procesando...');
        }

        console.log('[Telegram] ✅ Resumen enviado correctamente');

    } catch (err) {
        console.error('[Telegram] ❌ Error enviando resumen:', err.message);
    }
}

// ── Enviar alerta de recurso VIP nuevo ────────────────
async function sendVIPAlert(resource) {
    try {
        const message = `🚨 <b>¡NUEVO RECURSO VIP DETECTADO!</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n${formatResourceMessage(resource)}`;
        await sendMessage(message);
        console.log(`[Telegram] ✅ Alerta VIP enviada: ${resource.name}`);
    } catch (err) {
        console.error('[Telegram] ❌ Error enviando alerta VIP:', err.message);
    }
}

// ── Enviar notificación de pipeline completado ────────
async function sendPipelineComplete(results) {
    try {
        const message = `⚙️ <b>Pipeline Completado</b>\n\n` +
            `🕷️ Nuevos crawled: ${results.crawled || 0}\n` +
            `🧹 Normalizados: ${results.normalized || 0}\n` +
            `📊 Scored: ${results.scored || 0}\n` +
            `💎 VIP encontrados: ${results.vip || 0}\n\n` +
            `⏱️ ${new Date().toLocaleString('es-ES', { timeZone: 'America/Caracas' })}`;

        await sendMessage(message);
        console.log('[Telegram] ✅ Notificación de pipeline enviada');
    } catch (err) {
        console.error('[Telegram] ❌ Error:', err.message);
    }
}

module.exports = {
    sendMessage,
    sendDailySummary,
    sendVIPAlert,
    sendPipelineComplete,
    formatResourceMessage,
};

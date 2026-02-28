// ============================================
// Módulo de Análisis con IA (OpenRouter)
// Genera informes inteligentes de recursos descubiertos
// Usa modelos GRATUITOS para mantenerse bajo la capa free
// ============================================

const https = require('https');
const pool = require('../db/pool');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = 'google/gemma-3-4b-it:free'; // Modelo gratuito en OpenRouter

// ── Llamar a OpenRouter ───────────────────────────────
function callAI(prompt, maxTokens = 500) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: `Eres un analista experto en tecnología. Tu trabajo es evaluar recursos tecnológicos gratuitos y generar reportes concisos en español. 
Usa emojis para hacer los reportes visuales. Sé directo y práctico.
IMPORTANTE: Responde SOLO con el análisis, sin introducciones ni despedidas.
Máximo 300 palabras por análisis.`
                },
                { role: 'user', content: prompt }
            ],
            max_tokens: maxTokens,
            temperature: 0.7,
        });

        const options = {
            hostname: 'openrouter.ai',
            path: '/api/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://sistema-autonomo-recursos.onrender.com',
                'X-Title': 'Sistema Autonomo Recursos',
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.choices && parsed.choices[0]) {
                        resolve(parsed.choices[0].message.content.trim());
                    } else if (parsed.error) {
                        console.error('[AI] Error de API:', parsed.error.message || parsed.error);
                        resolve(null);
                    } else {
                        console.error('[AI] Respuesta inesperada:', data.substring(0, 200));
                        resolve(null);
                    }
                } catch (e) {
                    console.error('[AI] Error parseando respuesta:', e.message);
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => { console.error('[AI] Error de red:', e.message); resolve(null); });
        req.setTimeout(30000, () => { req.destroy(); resolve(null); });
        req.write(body);
        req.end();
    });
}

// ── Analizar un recurso individual ────────────────────
async function analyzeResource(resource) {
    const prompt = `Analiza este recurso tecnológico gratuito y genera un informe breve:

NOMBRE: ${resource.name}
URL: ${resource.url}
TIPO: ${resource.type || 'desconocido'}
DOMINIO: ${resource.domain || 'general'}
DESCRIPCIÓN: ${resource.description || 'Sin descripción disponible'}
FREE TIER: ${resource.free_tier || 'No especificado'}
AUTH REQUERIDA: ${resource.auth_required ? 'Sí' : 'No'}
TARJETA DE CRÉDITO: ${resource.credit_card ? 'Requerida' : 'No requerida'}
SCORE ACTUAL: Rareza=${resource.rarity_score}, Valor=${resource.value_score}, Riesgo=${resource.risk_score}, Final=${resource.final_score}

Genera un informe que incluya:
1. ¿Qué es exactamente este recurso? (1-2 líneas)
2. ¿Para qué sirve en la práctica? (casos de uso reales)
3. ¿Qué tan valioso es realmente siendo gratuito? (escala de 1-5 estrellas)
4. ¿Algún riesgo o limitación importante?
5. Veredicto final: ¿Vale la pena usarlo?`;

    const analysis = await callAI(prompt);

    if (analysis) {
        // Guardar el análisis en la base de datos
        await pool.query(
            `UPDATE resources SET tech_summary = $1, updated_at = NOW() WHERE id = $2`,
            [analysis, resource.id]
        );
        console.log(`[AI] ✅ Análisis generado para: ${resource.name}`);
    }

    return analysis;
}

// ── Generar informe batch de recursos nuevos ──────────
async function generateBatchReport(resources) {
    if (!resources || resources.length === 0) return null;
    if (!OPENROUTER_API_KEY) {
        console.log('[AI] ⚠️ No hay API key de OpenRouter configurada');
        return null;
    }

    const resourceList = resources.map((r, i) =>
        `${i + 1}. ${r.name} (${r.type || 'otro'}) — ${r.url}\n   Descripción: ${(r.description || 'N/A').substring(0, 100)}\n   Score: ${r.final_score}/100`
    ).join('\n\n');

    const prompt = `Aquí tienes ${resources.length} recursos tecnológicos gratuitos recién descubiertos por mi sistema autónomo. Genera un INFORME EJECUTIVO en español:

${resourceList}

El informe debe incluir:
1. 📊 RESUMEN — Cuántos recursos, de qué tipo, qué tan relevantes son
2. 🏆 DESTACADOS — Los 2-3 más valiosos y por qué
3. ⚠️ PRECAUCIONES — Algún recurso que parezca riesgoso o temporal
4. 💡 RECOMENDACIÓN — Qué debería explorar primero el usuario

Sé conciso pero informativo. Usa emojis y formato limpio.`;

    const report = await callAI(prompt, 800);
    return report;
}

// ── Analizar lote completo (con rate limiting) ────────
async function analyzeNewResources() {
    if (!OPENROUTER_API_KEY) {
        console.log('[AI] ⚠️ API key no configurada, saltando análisis');
        return { analyzed: 0, report: null };
    }

    try {
        // Solo analizar recursos que NO tienen tech_summary aún
        // Limitar a 5 por ciclo para no quemar la capa gratuita
        const { rows: unanalyzed } = await pool.query(`
      SELECT id, name, url, type, domain, description, free_tier,
             auth_required, credit_card, rarity_score, value_score, 
             risk_score, final_score
      FROM resources 
      WHERE (tech_summary IS NULL OR tech_summary = '')
        AND final_score > 0
      ORDER BY final_score DESC
      LIMIT 5
    `);

        if (unanalyzed.length === 0) {
            console.log('[AI] ℹ️ Todos los recursos ya están analizados');
            return { analyzed: 0, report: null };
        }

        console.log(`[AI] 🧠 Analizando ${unanalyzed.length} recursos con IA...`);

        let analyzed = 0;
        for (const resource of unanalyzed) {
            const result = await analyzeResource(resource);
            if (result) analyzed++;
            // Pausa entre llamadas para respetar rate limits gratuitos
            await new Promise(r => setTimeout(r, 3000));
        }

        // Generar informe batch
        const report = await generateBatchReport(unanalyzed);

        console.log(`[AI] ✅ ${analyzed}/${unanalyzed.length} recursos analizados`);
        return { analyzed, report };

    } catch (err) {
        console.error('[AI] ❌ Error en análisis:', err.message);
        return { analyzed: 0, report: null };
    }
}

module.exports = {
    callAI,
    analyzeResource,
    generateBatchReport,
    analyzeNewResources,
};

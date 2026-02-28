// ============================================
// Módulo de Análisis con IA — Cerebras
// Motor: Llama 3.3 70B via Cerebras Inference API
// 1,000,000 tokens/día gratis — sin tarjeta de crédito
// ============================================

const https = require('https');
const pool = require('../db/pool');

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || '';
const MODEL = 'gpt-oss-120b'; // Modelo más potente disponible en esta cuenta de Cerebras (120B parámetros)

// ── Llamar a la API de Cerebras ───────────────────────
function callAI(prompt, maxTokens = 800) {
    return new Promise((resolve, reject) => {
        if (!CEREBRAS_API_KEY) {
            console.warn('[AI] ⚠️  CEREBRAS_API_KEY no está configurada.');
            return resolve(null);
        }

        const body = JSON.stringify({
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: `Eres un analista tecnológico senior especializado en evaluar herramientas, plataformas y servicios digitales gratuitos para desarrolladores.

Tu misión es generar informes detallados, claros y útiles en español natural y conversacional. 
Escribe como si le explicaras a un colega desarrollador inteligente, no como un robot.
Usa emojis para estructurar visualmente el informe, pero sin exagerar.
Sé honesto: si algo tiene limitaciones importantes, dilo claramente.
Responde SOLO el contenido del informe, sin saludos ni despedidas.`
                },
                { role: 'user', content: prompt }
            ],
            max_completion_tokens: maxTokens,
            temperature: 0.7,
            top_p: 1,
            stream: false,
        });

        const options = {
            hostname: 'api.cerebras.ai',
            path: '/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${CEREBRAS_API_KEY}`,
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
                        const message = parsed.choices[0].message;
                        // gpt-oss-120b puede devolver content vacío con reasoning separado
                        const content = (message?.content && message.content.trim().length > 0)
                            ? message.content.trim()
                            : (message?.reasoning && message.reasoning.trim().length > 0)
                                ? message.reasoning.trim()
                                : null;
                        const usage = parsed.usage;
                        if (usage) {
                            console.log(`[AI] 📊 Tokens: ${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion = ${usage.total_tokens} total`);
                        }
                        resolve(content || null);
                    } else if (parsed.error) {
                        console.error('[AI] ❌ Error de Cerebras:', parsed.error.message || JSON.stringify(parsed.error));
                        resolve(null);
                    } else {
                        console.error('[AI] ⚠️ Respuesta inesperada de Cerebras:', data.substring(0, 300));
                        resolve(null);
                    }
                } catch (e) {
                    console.error('[AI] ❌ Error parseando respuesta JSON:', e.message);
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => {
            console.error('[AI] ❌ Error de red con Cerebras:', e.message);
            resolve(null);
        });

        req.setTimeout(45000, () => {
            console.error('[AI] ⏱️ Timeout esperando respuesta de Cerebras (45s)');
            req.destroy();
            resolve(null);
        });

        req.write(body);
        req.end();
    });
}

// ── Analizar un recurso individual con informe detallado ──
async function analyzeResource(resource) {
    const prompt = `Necesito que analices en profundidad el siguiente recurso tecnológico gratuito que mi sistema descubrió automáticamente en internet. 
Quiero un informe completo que me ayude a entender si vale la pena usarlo o recomendarlo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 DATOS DEL RECURSO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nombre:        ${resource.name}
URL:           ${resource.url}
Tipo:          ${resource.type || 'desconocido'}
Dominio técnico: ${resource.domain || 'general'}
Descripción:   ${resource.description || 'No se obtuvo descripción automáticamente.'}
Free Tier info: ${resource.free_tier || 'No especificado en los datos recolectados.'}
¿Requiere autenticación?: ${resource.auth_required ? 'Sí' : 'No especificado'}
¿Requiere tarjeta de crédito?: ${resource.credit_card ? 'Sí (dato importante)' : 'No / No especificado'}
Puntuación de mi sistema:
  → Rareza:   ${resource.rarity_score}/100
  → Valor:    ${resource.value_score}/100
  → Riesgo:   ${resource.risk_score}/100
  → FINAL:    ${resource.final_score}/100
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Genera el informe con esta estructura exacta:

🔍 **¿QUÉ ES?**
Explica con tus propias palabras qué hace esta plataforma/herramienta/servicio. Imagina que se lo explicas a alguien que nunca la ha visto. 2-3 oraciones naturales.

🛠️ **¿PARA QUÉ SIRVE EN LA PRÁCTICA?**
Lista 3-5 casos de uso concretos y reales. No genéricos, sino específicos. Ejemplo: "Puedes usarla para X si estás construyendo Y".

🆓 **¿QUÉ TAN BUENO ES EL TIER GRATUITO?**
Dale una calificación de ★☆☆☆☆ a ★★★★★ y explica por qué. ¿Es suficiente para un proyecto real? ¿Cuáles son los límites más importantes?

⚠️ **PRECAUCIONES Y LIMITACIONES**
¿Hay algo importante que el usuario debe saber antes de usarlo? Restricciones, términos dudosos, recursos que podrían ser efímeros, competidores mejores, etc.

✅ **VEREDICTO FINAL**
Una conclusión de 2-3 oraciones en tono directo. ¿Vale la pena? ¿Para quién es ideal? ¿Lo recomendarías?`;

    console.log(`[AI] 🧠 Analizando: ${resource.name}...`);
    const analysis = await callAI(prompt, 900);

    if (analysis) {
        await pool.query(
            `UPDATE resources SET 
                tech_summary = $1, 
                last_ai_analysis = NOW(),
                updated_at = NOW()
             WHERE id = $2`,
            [analysis, resource.id]
        );
        console.log(`[AI] ✅ Informe guardado para: ${resource.name}`);
    } else {
        console.warn(`[AI] ⚠️ No se pudo generar análisis para: ${resource.name}`);
    }

    return analysis;
}

// ── Informe ejecutivo batch de recursos nuevos ─────────
async function generateBatchReport(resources) {
    if (!resources || resources.length === 0) return null;
    if (!CEREBRAS_API_KEY) {
        console.log('[AI] ⚠️ No hay API key de Cerebras configurada');
        return null;
    }

    const resourceList = resources.map((r, i) =>
        `${i + 1}. ${r.name}\n   Tipo: ${r.type || 'otro'} | URL: ${r.url}\n   Descripción: ${(r.description || 'Sin descripción').substring(0, 120)}\n   Score del sistema: ${r.final_score}/100 (Rareza: ${r.rarity_score}, Valor: ${r.value_score}, Riesgo: ${r.risk_score})`
    ).join('\n\n');

    const prompt = `Mi sistema autónomo de descubrimiento de recursos tecnológicos gratuitos acaba de terminar un ciclo de análisis. 
Encontró ${resources.length} recursos nuevos. Necesito que generes un informe ejecutivo en español para que yo pueda revisar el lote rápidamente.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RECURSOS DESCUBIERTOS EN ESTE CICLO:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${resourceList}

Genera el informe con esta estructura:

📊 **RESUMEN DEL CICLO**
Un párrafo corto describiendo el lote: qué tipos de recursos aparecen más, de qué categorías son, qué tan relevantes parecen en general.

🏆 **LOS MÁS VALIOSOS**
Los 2 o 3 que más llaman la atención y por qué. Sé específico sobre qué los hace destacar.

🗑️ **LOS MÁS CUESTIONABLES**
Si hay alguno que parezca de poco valor, temporal, o sospechoso, mencionarlo con razones concretas.

💡 **RECOMENDACIÓN DE ACCIÓN**
¿Qué debería yo revisar primero? ¿Hay alguno que amerite integración inmediata en un proyecto? Dame una dirección clara.`;

    console.log(`[AI] 📋 Generando informe ejecutivo del lote (${resources.length} recursos)...`);
    const report = await callAI(prompt, 1000);
    return report;
}

// ── Pipeline principal de análisis ────────────────────
async function analyzeNewResources() {
    if (!CEREBRAS_API_KEY) {
        console.log('[AI] ⚠️ CEREBRAS_API_KEY no configurada — saltando análisis de IA');
        return { analyzed: 0, report: null };
    }

    try {
        // Obtener recursos sin analizar, priorizando los de mayor puntaje
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
            console.log('[AI] ℹ️ Todos los recursos visibles ya tienen análisis de IA.');
            return { analyzed: 0, report: null };
        }

        console.log(`[AI] 🧠 Iniciando análisis de ${unanalyzed.length} recursos con Cerebras (${MODEL})...`);

        let analyzed = 0;
        for (const resource of unanalyzed) {
            const result = await analyzeResource(resource);
            if (result) analyzed++;
            // Pausa entre llamadas para respetar rate limits
            await new Promise(r => setTimeout(r, 2000));
        }

        // Generar informe ejecutivo del lote
        const report = await generateBatchReport(unanalyzed);

        // Registrar en el log del sistema
        await pool.query(
            `INSERT INTO system_log (module, action, status, message, metadata)
             VALUES ('analyzer', 'analyze_batch', 'success', $1, $2)`,
            [
                `${analyzed}/${unanalyzed.length} recursos analizados con Cerebras (${MODEL})`,
                JSON.stringify({ analyzed, total: unanalyzed.length, model: MODEL })
            ]
        );

        console.log(`[AI] ✅ ${analyzed}/${unanalyzed.length} recursos analizados correctamente.`);
        return { analyzed, report };

    } catch (err) {
        console.error('[AI] ❌ Error en el pipeline de análisis:', err.message);
        await pool.query(
            `INSERT INTO system_log (module, action, status, message)
             VALUES ('analyzer', 'analyze_batch', 'error', $1)`,
            [err.message]
        ).catch(() => { });
        return { analyzed: 0, report: null };
    }
}

module.exports = {
    callAI,
    analyzeResource,
    generateBatchReport,
    analyzeNewResources,
};

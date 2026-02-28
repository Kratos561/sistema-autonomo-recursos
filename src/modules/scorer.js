const pool = require('../db/pool');

// ══════════════════════════════════════════════
// Módulo 4: Evaluación de Rareza y Valor
// Score = Rareza × Valor − Riesgo
// ══════════════════════════════════════════════

// ── Calcular rareza ─────────────────────────────────────
// Baja presencia en buscadores, pocas menciones, docs mínimos, origen académico/beta
function calculateRarity(resource) {
    let rarity = 50; // Base score

    // URLs menos conocidas son más raras
    const commonDomains = ['github.com', 'google.com', 'aws.amazon.com', 'azure.com', 'firebase.google.com'];
    const isCommonDomain = commonDomains.some(d => resource.url?.includes(d));
    if (!isCommonDomain) rarity += 20;

    // Nombres cortos tienden a ser más establecidos (menos raros)
    if (resource.name && resource.name.length > 30) rarity += 10;

    // Fuente académica / beta
    if (resource.url?.includes('arxiv') || resource.url?.includes('beta') || resource.url?.includes('research')) {
        rarity += 15;
    }

    // Dominio .io, .dev, .tech suelen ser más nuevos
    if (resource.url?.match(/\.(io|dev|tech|app)\//)) {
        rarity += 5;
    }

    return Math.min(rarity, 100);
}

// ── Calcular valor ──────────────────────────────────────
// Potencia técnica, límites gratuitos, estabilidad, facilidad de acceso
function calculateValue(resource) {
    let value = 30; // Base score

    // Valor por tipo de recurso
    const typeValues = { api: 25, database: 20, vps: 30, compute: 30, storage: 15, tool: 10, other: 5 };
    value += typeValues[resource.type] || 5;

    // No requiere tarjeta de crédito = más accesible
    if (!resource.credit_card) value += 15;

    // No requiere auth = más fácil de usar
    if (!resource.auth_required) value += 5;

    // Tiene info sobre free tier documentado
    if (resource.free_tier && resource.free_tier.length > 0) value += 10;

    // Dominio técnico potente
    if (['ml', 'compute', 'nlp', 'vision'].includes(resource.domain)) value += 10;

    return Math.min(value, 100);
}

// ── Calcular riesgo ─────────────────────────────────────
function calculateRisk(resource) {
    let risk = 10; // Base risk

    // Dominios desconocidos = más riesgo
    if (resource.url?.match(/\.(xyz|club|icu|top)\//)) {
        risk += 30;
    }

    // Sin descripción = más riesgo
    if (!resource.description || resource.description.length < 20) {
        risk += 15;
    }

    // Estado degradado o desconocido
    if (resource.status === 'degraded') risk += 20;
    if (resource.status === 'unknown') risk += 10;

    return Math.min(risk, 100);
}

// ── Calcular score final ────────────────────────────────
function calculateFinalScore(rarity, value, risk) {
    // Score = (Rareza × Valor) / 100 − Riesgo × 0.3
    const score = ((rarity * value) / 100) - (risk * 0.3);
    return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

// ── Evaluar todos los recursos pendientes ───────────────
async function evaluateResources() {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM resources 
       WHERE final_score = 0 OR updated_at > last_checked
       ORDER BY created_at DESC
       LIMIT 200`
        );

        console.log(`[Scorer] Evaluando ${rows.length} recursos...`);
        let scored = 0;

        for (const resource of rows) {
            const rarity = calculateRarity(resource);
            const value = calculateValue(resource);
            const risk = calculateRisk(resource);
            const finalScore = calculateFinalScore(rarity, value, risk);

            await pool.query(
                `UPDATE resources SET
          rarity_score = $1,
          value_score = $2,
          risk_score = $3,
          final_score = $4,
          last_checked = NOW()
         WHERE id = $5`,
                [rarity, value, risk, finalScore, resource.id]
            );

            // Si el score es alto, crear alerta
            if (finalScore >= 60) {
                await pool.query(
                    `INSERT INTO alerts (resource_id, alert_type, title, message)
           VALUES ($1, 'high_score', $2, $3)
           ON CONFLICT DO NOTHING`,
                    [resource.id, `🏆 Recurso valioso: ${resource.name}`, `Score: ${finalScore} | Rareza: ${rarity} | Valor: ${value}`]
                );
            }

            scored++;
        }

        console.log(`[Scorer] ✅ ${scored} recursos evaluados`);

        await pool.query(
            `INSERT INTO system_log (module, action, status, message)
       VALUES ('scorer', 'evaluate_all', 'success', $1)`,
            [`${scored} recursos evaluados`]
        );

        return scored;
    } catch (err) {
        console.error('[Scorer] Error:', err.message);
        return 0;
    }
}

module.exports = { evaluateResources, calculateRarity, calculateValue, calculateRisk, calculateFinalScore };

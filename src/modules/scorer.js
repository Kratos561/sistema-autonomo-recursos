const pool = require('../db/pool');

// ══════════════════════════════════════════════
// Módulo 4: Evaluación de Rareza y Valor (v2)
// Score = Rareza × Valor − Riesgo
// ══════════════════════════════════════════════

// Dominios de proveedores tech conocidos (high trust)
const TRUSTED_PROVIDERS = [
    'supabase.com', 'vercel.com', 'netlify.com', 'railway.app', 'render.com',
    'fly.io', 'planetscale.com', 'neon.tech', 'upstash.com', 'turso.tech',
    'cloudflare.com', 'workers.dev', 'deno.com', 'val.town',
    'appwrite.io', 'pocketbase.io', 'directus.io', 'strapi.io',
    'huggingface.co', 'replicate.com', 'together.ai', 'groq.com',
    'openai.com', 'anthropic.com', 'cohere.com', 'mistral.ai',
    'mongodb.com', 'redis.io', 'cockroachlabs.com', 'yugabyte.com',
    'digitalocean.com', 'linode.com', 'vultr.com', 'oracle.com/cloud',
    'sentry.io', 'grafana.com', 'datadog.com', 'newrelic.com',
    'auth0.com', 'clerk.com', 'firebase.google.com', 'aws.amazon.com',
    'heroku.com', 'glitch.com', 'replit.com', 'stackblitz.com',
];

// ── Calcular rareza ─────────────────────────────────────
function calculateRarity(resource) {
    let rarity = 30; // Base más baja

    // Proveedores muy conocidos = menos raros
    const isTrusted = TRUSTED_PROVIDERS.some(d => resource.url?.includes(d));
    if (isTrusted) {
        rarity += 10; // Conocido pero confiable
    } else {
        rarity += 30; // Menos conocido = más raro
    }

    // Si viene de free-for.dev o lista curada, es más raro (hard to find)
    if (resource.source_type === 'free-for-dev' || resource.source_type === 'github-list') {
        rarity += 15;
    }

    // Dominio .io, .dev, .tech, .app suelen ser startups nuevas
    if (resource.url?.match(/\.(io|dev|tech|app|ai|sh)\//)) {
        rarity += 10;
    }

    // Fuente académica / beta / research
    if (resource.url?.includes('arxiv') || resource.url?.includes('beta') || resource.url?.includes('research')) {
        rarity += 15;
    }

    return Math.min(rarity, 100);
}

// ── Calcular valor ──────────────────────────────────────
function calculateValue(resource) {
    let value = 20; // Base más baja

    const text = `${resource.name || ''} ${resource.description || ''} ${resource.free_tier || ''}`.toLowerCase();

    // Valor por tipo de recurso
    const typeValues = { api: 25, database: 25, vps: 35, compute: 35, storage: 20, tool: 15, other: 5 };
    value += typeValues[resource.type] || 5;

    // Keywords de alto valor en la descripción
    const highValueKeywords = [
        'free tier', 'free plan', 'always free', 'forever free', 'no credit card',
        'generous free', 'unlimited', 'lifetime', 'open source', 'self-hosted',
    ];
    for (const kw of highValueKeywords) {
        if (text.includes(kw)) { value += 8; break; }
    }

    // No requiere tarjeta = más accesible
    if (!resource.credit_card) value += 10;

    // Tiene info sobre free tier documentado
    if (resource.free_tier && resource.free_tier.length > 0) value += 10;

    // Dominio técnico de alto impacto
    const highImpactDomains = ['ml', 'compute', 'nlp', 'vision'];
    if (highImpactDomains.includes(resource.domain)) value += 10;

    // Si es un proveedor trusted, tiene más valor (estable)
    const isTrusted = TRUSTED_PROVIDERS.some(d => resource.url?.includes(d));
    if (isTrusted) value += 10;

    return Math.min(value, 100);
}

// ── Calcular riesgo ─────────────────────────────────────
function calculateRisk(resource) {
    let risk = 5; // Base baja

    const text = `${resource.name || ''} ${resource.description || ''}`.toLowerCase();

    // Dominios sospechosos
    if (resource.url?.match(/\.(xyz|club|icu|top|buzz|cam)\//)) risk += 30;

    // Sin descripción = no sabemos qué es
    if (!resource.description || resource.description.length < 10) risk += 20;

    // Keywords de riesgo
    const riskKeywords = ['trial', 'expires', 'limited time', 'beta only', 'deprecated', 'shutdown'];
    for (const kw of riskKeywords) {
        if (text.includes(kw)) { risk += 15; break; }
    }

    // Requiere tarjeta de crédito
    if (resource.credit_card) risk += 20;

    // Status degradado
    if (resource.status === 'degraded') risk += 15;
    if (resource.status === 'dead') risk += 40;

    return Math.min(risk, 100);
}

// ── Calcular score final ────────────────────────────────
function calculateFinalScore(rarity, value, risk) {
    // Score = (Rareza × Valor) / 100 − Riesgo × 0.5
    const score = ((rarity * value) / 100) - (risk * 0.5);
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

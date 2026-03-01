const pool = require('../db/pool');

// ── Normalizar recurso crudo ────────────────────────────
function normalizeText(text) {
    if (!text) return '';
    return text
        .replace(/\s+/g, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/[^\w\s\-.,;:!?()\/\[\]@#$%&*+='"]/g, '')
        .trim();
}

function detectLanguage(text) {
    if (!text) return 'en';
    const spanishWords = ['gratis', 'libre', 'herramienta', 'datos', 'servidor', 'código'];
    const lowerText = text.toLowerCase();
    const isSpanish = spanishWords.some(w => lowerText.includes(w));
    return isSpanish ? 'es' : 'en';
}

function detectResourceType(text, url) {
    const lowerText = (text + ' ' + url).toLowerCase();
    // Sentinel-aligned type detection
    if (lowerText.includes('api') || lowerText.includes('endpoint') || lowerText.includes('rest') || lowerText.includes('websocket')) return 'api';
    if (lowerText.includes('database') || lowerText.includes('db') || lowerText.includes('sql') || lowerText.includes('mongo') || lowerText.includes('vector')) return 'database';
    if (lowerText.includes('vps') || lowerText.includes('server') || lowerText.includes('vm') || lowerText.includes('instance') || lowerText.includes('hosting')) return 'vps';
    if (lowerText.includes('compute') || lowerText.includes('gpu') || lowerText.includes('cpu') || lowerText.includes('serverless') || lowerText.includes('edge')) return 'compute';
    if (lowerText.includes('storage') || lowerText.includes('s3') || lowerText.includes('bucket')) return 'storage';
    if (lowerText.includes('tool') || lowerText.includes('cli') || lowerText.includes('sdk') || lowerText.includes('library') || lowerText.includes('framework')) return 'tool';
    return 'other';
}

function detectDomain(text) {
    const lowerText = (text || '').toLowerCase();
    // 🥷 Ciberseguridad y Stealth
    if (/proxy|stealth|anti.?detect|cloudflare|bypass|scraping|captcha|fingerprint|headless|undetectable|turnstile|puppeteer|playwright/i.test(lowerText)) return 'security';
    // 🧠 IA y Modelos Cuantitativos
    if (/machine learning|llm|embedding|huggingface|gguf|fine.?tune|inference|transformer|neural|deep learning|prediction model|financial llm/i.test(lowerText)) return 'ml';
    // 🩸 Datos Alternativos / Alpha de Mercado
    if (/market data|cryptocurrency|stocks|forex|order flow|dark pool|economic calendar|ohlcv|tick data|on.?chain|exchange api|trading|backtesting|algo.?trad/i.test(lowerText)) return 'data';
    // ⚙️ Optimización y DevOps
    if (/low latency|memory leak|v8|zero.?copy|performance|benchmark|garbage collection|worker thread|optimization|ci\/cd|deploy|docker|kubernetes/i.test(lowerText)) return 'devops';
    // ⚡ Compute y Cloud
    if (/compute|gpu|cpu|processing|serverless|edge computing|cloud|paas|hosting/i.test(lowerText)) return 'compute';
    // General / NLP / Vision fallback
    if (lowerText.includes('nlp') || lowerText.includes('language') || lowerText.includes('text')) return 'nlp';
    if (lowerText.includes('vision') || lowerText.includes('image') || lowerText.includes('ocr')) return 'vision';
    return 'general';
}

function extractTechEntities(text) {
    if (!text) return {};
    const entities = {};

    // Detectar límites
    const limitPatterns = [
        /(\d+[\s,]*\d*)\s*(requests?|calls?|queries?)\s*(per|\/)\s*(minute|hour|day|month)/gi,
        /free\s+tier[:\s]+([^.]+)/gi,
        /(\d+)\s*(GB|MB|TB)\s*(free|storage|bandwidth)/gi,
    ];

    entities.limits = [];
    for (const pattern of limitPatterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            entities.limits.push(match[0]);
        }
    }

    // Detectar auth requirements
    entities.auth_required = /api[_\s]?key|token|oauth|signup|register/i.test(text);
    entities.credit_card = /credit\s*card|billing|payment/i.test(text);

    return entities;
}

// ── Normalizar todos los recursos pendientes ────────────
async function normalizeResources() {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM resources 
       WHERE type = 'other' OR description IS NULL OR description = ''
       ORDER BY created_at DESC
       LIMIT 100`
        );

        console.log(`[Normalizer] Normalizando ${rows.length} recursos...`);
        let processed = 0;

        for (const resource of rows) {
            const cleanName = normalizeText(resource.name);
            const cleanDesc = normalizeText(resource.description);
            const fullText = `${cleanName} ${cleanDesc}`;

            const type = detectResourceType(fullText, resource.url);
            const domain = detectDomain(fullText);
            const language = detectLanguage(fullText);
            const entities = extractTechEntities(fullText);

            await pool.query(
                `UPDATE resources SET
          name = $1,
          description = $2,
          type = $3,
          domain = $4,
          language = $5,
          auth_required = $6,
          credit_card = $7,
          free_tier = $8,
          updated_at = NOW()
         WHERE id = $9`,
                [
                    cleanName,
                    cleanDesc,
                    type,
                    domain,
                    language,
                    entities.auth_required || false,
                    entities.credit_card || false,
                    entities.limits?.join('; ') || null,
                    resource.id,
                ]
            );
            processed++;
        }

        console.log(`[Normalizer] ✅ ${processed} recursos normalizados`);

        await pool.query(
            `INSERT INTO system_log (module, action, status, message)
       VALUES ('normalizer', 'normalize_all', 'success', $1)`,
            [`${processed} recursos normalizados`]
        );

        return processed;
    } catch (err) {
        console.error('[Normalizer] Error:', err.message);
        return 0;
    }
}

module.exports = { normalizeResources, normalizeText, detectResourceType, detectDomain };

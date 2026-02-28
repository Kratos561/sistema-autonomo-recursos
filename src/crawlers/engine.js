const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db/pool');

const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT_MS) || 15000;

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

// ── Crawler genérico ────────────────────────────────────
async function fetchPage(url) {
    try {
        const response = await axios.get(url, {
            headers: HEADERS,
            timeout: TIMEOUT,
            maxRedirects: 5,
        });
        return { html: response.data, status: response.status };
    } catch (err) {
        console.error(`[Crawler] Error fetching ${url}:`, err.message);
        return null;
    }
}

// ── Crawler para Reddit JSON API ────────────────────────
async function crawlReddit(url) {
    try {
        const jsonUrl = url.endsWith('.json') ? url : `${url}.json`;
        const response = await axios.get(jsonUrl, {
            headers: { 'User-Agent': 'SistemaAutonomo/1.0' },
            timeout: TIMEOUT,
        });

        const posts = response.data?.data?.children || [];
        const resources = [];

        for (const post of posts) {
            const data = post.data;
            if (!data.url || data.is_self) continue;

            resources.push({
                name: data.title?.substring(0, 255),
                url: data.url,
                description: data.selftext?.substring(0, 1000) || '',
                source_url: `https://reddit.com${data.permalink}`,
                source_type: 'reddit',
            });
        }

        return resources;
    } catch (err) {
        console.error('[Crawler Reddit] Error:', err.message);
        return [];
    }
}

// ── Crawler para GitHub ─────────────────────────────────
async function crawlGitHub(url) {
    try {
        const result = await fetchPage(url);
        if (!result) return [];

        const $ = cheerio.load(result.html);
        const resources = [];

        // Extraer enlaces de repositorios o artículos
        $('a[href*="github.com"]').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            if (href && text && !href.includes('/topics') && !href.includes('/trending')) {
                resources.push({
                    name: text.substring(0, 255),
                    url: href.startsWith('http') ? href : `https://github.com${href}`,
                    description: '',
                    source_url: url,
                    source_type: 'github',
                });
            }
        });

        return resources.slice(0, 50);
    } catch (err) {
        console.error('[Crawler GitHub] Error:', err.message);
        return [];
    }
}

// ── Crawler genérico para sitios web ────────────────────
async function crawlGeneric(url) {
    try {
        const result = await fetchPage(url);
        if (!result) return [];

        const $ = cheerio.load(result.html);
        const resources = [];

        // Buscar enlaces que parezcan APIs, herramientas o servicios
        const keywords = ['api', 'free', 'open', 'developer', 'docs', 'pricing', 'tier'];

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim().toLowerCase();

            if (href && keywords.some(kw => text.includes(kw) || href.includes(kw))) {
                let fullUrl = href;
                if (!href.startsWith('http')) {
                    try {
                        fullUrl = new URL(href, url).toString();
                    } catch { return; }
                }

                resources.push({
                    name: $(el).text().trim().substring(0, 255) || 'Sin nombre',
                    url: fullUrl,
                    description: '',
                    source_url: url,
                    source_type: 'web',
                });
            }
        });

        return resources.slice(0, 50);
    } catch (err) {
        console.error('[Crawler Generic] Error:', err.message);
        return [];
    }
}

// ── Dispatcher principal ────────────────────────────────
async function crawlSource(source) {
    console.log(`[Crawler] 🔍 Crawleando: ${source.name} (${source.url})`);

    let results = [];

    if (source.url.includes('reddit.com')) {
        results = await crawlReddit(source.url);
    } else if (source.url.includes('github.com')) {
        results = await crawlGitHub(source.url);
    } else {
        results = await crawlGeneric(source.url);
    }

    // Actualizar última vez que se crawleó
    await pool.query(
        `UPDATE crawl_sources SET last_crawled = NOW() WHERE id = $1`,
        [source.id]
    );

    console.log(`[Crawler] ✅ ${results.length} recursos encontrados en ${source.name}`);
    return results;
}

// ── Ejecutar todos los crawlers ─────────────────────────
async function runAllCrawlers() {
    try {
        const { rows: sources } = await pool.query(
            `SELECT * FROM crawl_sources WHERE is_active = true ORDER BY last_crawled ASC NULLS FIRST`
        );

        console.log(`[Crawler] Iniciando crawling de ${sources.length} fuentes...`);

        let totalResources = 0;

        for (const source of sources) {
            try {
                const resources = await crawlSource(source);
                totalResources += resources.length;

                // Pasar al módulo de normalización
                for (const resource of resources) {
                    await saveRawResource(resource);
                }

                // Backoff entre fuentes
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (err) {
                console.error(`[Crawler] Error en ${source.name}:`, err.message);
                await pool.query(
                    `UPDATE crawl_sources SET success_rate = GREATEST(success_rate - 5, 0) WHERE id = $1`,
                    [source.id]
                );
            }
        }

        await pool.query(
            `INSERT INTO system_log (module, action, status, message, metadata)
       VALUES ('crawler', 'run_all', 'success', $1, $2)`,
            [`Crawling completado: ${totalResources} recursos encontrados`, JSON.stringify({ sources: sources.length, resources: totalResources })]
        );

        return totalResources;
    } catch (err) {
        console.error('[Crawler] Error general:', err.message);
        return 0;
    }
}

// ── Guardar recurso crudo ───────────────────────────────
async function saveRawResource(resource) {
    try {
        await pool.query(
            `INSERT INTO resources (name, url, description, source_url, source_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (url) DO UPDATE SET
         last_checked = NOW(),
         updated_at = NOW()`,
            [resource.name, resource.url, resource.description, resource.source_url, resource.source_type]
        );
    } catch (err) {
        // Ignorar duplicados silenciosamente
        if (!err.message.includes('duplicate')) {
            console.error('[Crawler] Error guardando recurso:', err.message);
        }
    }
}

module.exports = { crawlSource, runAllCrawlers, fetchPage };

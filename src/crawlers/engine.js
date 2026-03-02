const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db/pool');

const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT_MS) || 15000;

// URLs basura que NO son recursos tecnológicos reales
const JUNK_DOMAINS = [
    'i.redd.it', 'v.redd.it', 'preview.redd.it', 'i.imgur.com',
    'imgur.com', 'gfycat.com', 'giphy.com', 'youtube.com', 'youtu.be',
    'twitter.com', 'x.com', 'reddit.com', 'redd.it',
    'facebook.com', 'instagram.com', 'tiktok.com',
    'amazon.com', 'ebay.com', 'aliexpress.com',
];

// Extensiones de archivos que NO son recursos tech
const JUNK_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
    '.mp4', '.mov', '.avi', '.mp3', '.wav', '.pdf',
];

// ══════════════════════════════════════════════════════════════
// 🧠 CATEGORÍA 7: SOBERANÍA DEL CEREBRO DL
// GPU 24/7, Keep-Alive, Serverless BYOM, ARM, Créditos y Grants
// ══════════════════════════════════════════════════════════════
const TECH_KEYWORDS = [
    // 🖥️ A. Persistencia en Notebooks (Evasión de Timeouts)
    'keep-alive', 'keepalive', 'colab', 'google colab', 'kaggle', 'sagemaker', 'paperspace',
    'gradient', 'notebook', 'idle timeout', 'session timeout', 'colab pro',
    'ngrok', 'cloudflare tunnel', 'cloudflared', 'tailscale', 'grpc', 'fastapi',
    'tunnel', 'anti-idle', 'idle prevention', 'auto reconnect', 'persistent session',
    'inference server', 'model server', 'triton', 'torchserve',

    // ⚡ B. Inferencia Serverless con Capas Gratuitas (BYOM)
    'fal.ai', 'fal ai', 'together ai', 'togetherai', 'modal', 'modal labs',
    'hugging face', 'huggingface', 'inference endpoint', 'bring your own model', 'byom',
    'cold start', 'warm start', 'serverless inference', 'inference api',
    'replicate', 'beam', 'baseten', 'lepton', 'fireworks ai', 'anyscale',
    'free inference', 'free gpu credits', 'pytorch', 'jax', 'triton inference',

    // 🦾 C. Instancias ARM de Alto Rendimiento (Oracle Always Free)
    'oracle cloud', 'oracle free', 'ampere a1', 'arm instance', 'always free',
    'openvino', 'onnx runtime', 'onnx', 'quantization', 'cpu inference', 'arm64',
    'aarch64', 'graviton', 'neon optimization', 'model optimization', 'int8',
    'fp16', 'bfloat16', 'neural compressor', 'prune', 'distillation',

    // 💰 D. Cosecha de Créditos GPU (Founders & Hackers)
    'lambda labs', 'runpod', 'vast.ai', 'vast ai', 'gpu credits', 'free credits',
    'gpu cloud', '$300 free', '$200 free', 'founders credit', 'startup credit',
    'developer credit', 'early access gpu', 'beta gpu', 'a100', 'h100', 'l4 gpu', 't4 gpu',
    'v100', 'rtx 4090', 'a10g', 'compute credit', 'cloud credit grant',
    'nvidia gpu free', 'gpu trial', 'coreweave', 'massed compute',

    // 🐳 E. Docker con Aceleración de Hardware + No Sleep
    'docker gpu', 'nvidia container', 'cuda container', 'hardware acceleration',
    'no sleep', 'prevent sleep', 'container keep alive', 'render free tier',
    'railway gpu', 'fly.io gpu', 'zero downtime', 'always on', '24/7 inference',
    'gpu docker', 'nvidia docker', 'cuda docker', 'gpu paas',

    // 🎓 F. Subvenciones y Becas de Cómputo (Sin empresa requerida)
    'azure for startups', 'google for startups', 'aws activate', 'startup program',
    'compute grant', 'research grant', 'open source credits', 'github credits',
    'github student', 'education credits', 'hackathon gpu', 'compute subsidy',
    'accelerator program', 'incubator cloud', 'tech for good', 'developer program',
    'startup equity free', 'solo founder', 'indie hacker', 'open source grant',

    // 🔧 Términos de soporte técnico transversales
    'gpu free', 'free gpu', 'gpu inference', 'deep learning', 'neural network',
    'model weights', 'checkpoint', 'fine-tune', 'lora', 'qlora', 'llm free',
    'diffusion model', 'stable diffusion', 'llama', 'mistral', 'phi', 'gemma',
];

const HEADERS_LIST = [
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
    { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15' },
    { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0' },
];

function getRandomHeaders() {
    return { ...HEADERS_LIST[Math.floor(Math.random() * HEADERS_LIST.length)], 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' };
}

// ── Verificar si una URL es un recurso real ─────────────
function isValidResourceUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        // Rechazar dominios basura
        if (JUNK_DOMAINS.some(d => hostname.includes(d))) return false;
        // Rechazar extensiones de archivos multimedia
        const pathname = parsed.pathname.toLowerCase();
        if (JUNK_EXTENSIONS.some(ext => pathname.endsWith(ext))) return false;
        // Debe ser HTTP/HTTPS
        if (!['http:', 'https:'].includes(parsed.protocol)) return false;
        return true;
    } catch {
        return false;
    }
}

// ── Verificar si el título/contexto parece un recurso tech ──
function looksLikeTechResource(name, description = '') {
    const text = `${name} ${description}`.toLowerCase();
    return TECH_KEYWORDS.some(kw => text.includes(kw));
}

// ── Crawler genérico ────────────────────────────────────
async function fetchPage(url) {
    try {
        const response = await axios.get(url, {
            headers: getRandomHeaders(),
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
// Ahora extrae LINKS EXTERNOS, no las URLs de los posts de Reddit
async function crawlReddit(url) {
    try {
        const jsonUrl = url.endsWith('.json') ? url : `${url}.json`;
        const response = await axios.get(jsonUrl, {
            headers: { 'User-Agent': 'SistemaAutonomo/1.0 (by u/bot)' },
            timeout: TIMEOUT,
        });

        const posts = response.data?.data?.children || [];
        const resources = [];

        for (const post of posts) {
            const data = post.data;
            if (!data.title) continue;

            // Verificar si el post es sobre tech
            const isTech = looksLikeTechResource(data.title, data.selftext || '');
            if (!isTech) continue;

            // PRIORIDAD 1: Link externo directo del post (no self-posts ni imágenes)
            if (data.url && !data.is_self && isValidResourceUrl(data.url)) {
                resources.push({
                    name: data.title.substring(0, 255),
                    url: data.url,
                    description: (data.selftext || '').substring(0, 1000),
                    source_url: `https://reddit.com${data.permalink}`,
                    source_type: 'reddit',
                });
                continue;
            }

            // PRIORIDAD 2: Extraer URLs del cuerpo del post (selftext)
            if (data.selftext) {
                const urlRegex = /https?:\/\/[^\s\)\]\>,\"]+/g;
                const foundUrls = data.selftext.match(urlRegex) || [];

                for (const foundUrl of foundUrls) {
                    // Limpiar URL (quitar trailing punctuation)
                    const cleanUrl = foundUrl.replace(/[.,;:!?)]+$/, '');
                    if (isValidResourceUrl(cleanUrl)) {
                        resources.push({
                            name: data.title.substring(0, 255),
                            url: cleanUrl,
                            description: (data.selftext || '').substring(0, 1000),
                            source_url: `https://reddit.com${data.permalink}`,
                            source_type: 'reddit',
                        });
                        break; // Solo el primer link válido por post
                    }
                }
            }
        }

        return resources;
    } catch (err) {
        console.error('[Crawler Reddit] Error:', err.message);
        return [];
    }
}

// ── Crawler para GitHub (usando API pública) ────────────
async function crawlGitHub(url) {
    try {
        // Si es la página de trending, scrapeamos el HTML
        if (url.includes('/trending') || url.includes('/topics')) {
            return await crawlGitHubHTML(url);
        }

        // Si es un repo específico con listas de APIs (como public-apis)
        if (url.includes('public-apis/public-apis') || url.includes('free-for')) {
            return await crawlResourceList(url);
        }

        return await crawlGitHubHTML(url);
    } catch (err) {
        console.error('[Crawler GitHub] Error:', err.message);
        return [];
    }
}

// Crawl GitHub trending/topics page
async function crawlGitHubHTML(url) {
    try {
        const result = await fetchPage(url);
        if (!result) return [];

        const $ = cheerio.load(result.html);
        const resources = [];
        const seen = new Set();

        // Buscar repos en trending
        $('article.Box-row h2 a, h3 a[href*="/"]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href || seen.has(href)) return;

            const fullUrl = `https://github.com${href}`;
            const name = $(el).text().trim().replace(/\s+/g, ' ');

            if (name && href.split('/').length >= 3) {
                seen.add(href);
                // Extraer descripción del repo si existe
                const desc = $(el).closest('article, .Box-row, li').find('p').first().text().trim();

                resources.push({
                    name: name.substring(0, 255),
                    url: fullUrl,
                    description: desc.substring(0, 1000) || '',
                    source_url: url,
                    source_type: 'github',
                });
            }
        });

        return resources.slice(0, 30);
    } catch (err) {
        console.error('[Crawler GitHub HTML] Error:', err.message);
        return [];
    }
}

// Crawl repos que contienen listas de recursos (como awesome-x, public-apis)
async function crawlResourceList(url) {
    try {
        // Intentar obtener el README del repo
        const parts = new URL(url).pathname.split('/').filter(Boolean);
        if (parts.length < 2) return [];

        const readmeUrl = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/main/README.md`;
        let response;
        try {
            response = await axios.get(readmeUrl, { headers: getRandomHeaders(), timeout: TIMEOUT });
        } catch {
            const readmeUrlMaster = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/master/README.md`;
            response = await axios.get(readmeUrlMaster, { headers: getRandomHeaders(), timeout: TIMEOUT });
        }

        const readme = response.data;
        const resources = [];
        const seen = new Set();

        // Extraer links de formato markdown: [nombre](url)
        const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
        let match;

        while ((match = linkRegex.exec(readme)) !== null) {
            const name = match[1].trim();
            const linkUrl = match[2].trim();

            if (seen.has(linkUrl)) continue;
            if (!isValidResourceUrl(linkUrl)) continue;
            // Ignorar links a otros repos github (queremos los links a las tools reales)
            if (linkUrl.includes('github.com') && !linkUrl.includes('github.com/apps')) continue;
            // Ignorar links cortos sin nombre real
            if (name.length < 3) continue;

            seen.add(linkUrl);
            resources.push({
                name: name.substring(0, 255),
                url: linkUrl,
                description: '',
                source_url: url,
                source_type: 'github-list',
            });
        }

        console.log(`[Crawler] 📋 Extraídos ${resources.length} links de lista: ${url}`);
        return resources.slice(0, 100); // Las listas pueden ser grandes
    } catch (err) {
        console.error('[Crawler Resource List] Error:', err.message);
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
        const seen = new Set();

        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();

            if (!href || !text || text.length < 5) return;

            let fullUrl = href;
            if (!href.startsWith('http')) {
                try { fullUrl = new URL(href, url).toString(); } catch { return; }
            }

            if (seen.has(fullUrl)) return;
            if (!isValidResourceUrl(fullUrl)) return;

            // Solo links que parezcan recursos tech
            const context = `${text} ${$(el).attr('title') || ''}`;
            if (looksLikeTechResource(context, '')) {
                seen.add(fullUrl);
                resources.push({
                    name: text.substring(0, 255),
                    url: fullUrl,
                    description: $(el).closest('li, div, article, tr').text().trim().substring(0, 500) || '',
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

// ── Crawler para free-for.dev ───────────────────────────
async function crawlFreeForDev(url) {
    try {
        // free-for.dev tiene su data en markdown en GitHub
        const readmeUrl = 'https://raw.githubusercontent.com/ripienaar/free-for-dev/master/README.md';
        const response = await axios.get(readmeUrl, { headers: getRandomHeaders(), timeout: TIMEOUT });
        const readme = response.data;
        const resources = [];
        const seen = new Set();

        // Extraer links markdown
        const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
        let match;
        let currentSection = 'general';

        const lines = readme.split('\n');
        for (const line of lines) {
            // Detectar sección actual
            const sectionMatch = line.match(/^##\s+(.+)/);
            if (sectionMatch) {
                currentSection = sectionMatch[1].trim().toLowerCase();
                continue;
            }

            // Buscar links en la línea
            linkRegex.lastIndex = 0;
            while ((match = linkRegex.exec(line)) !== null) {
                const name = match[1].trim();
                const linkUrl = match[2].trim();

                if (seen.has(linkUrl)) continue;
                if (!isValidResourceUrl(linkUrl)) continue;
                if (linkUrl.includes('github.com')) continue;
                if (name.length < 3) continue;

                seen.add(linkUrl);
                const desc = line.replace(match[0], '').replace(/^[\s\-\*]+/, '').trim();

                resources.push({
                    name: name.substring(0, 255),
                    url: linkUrl,
                    description: `[${currentSection}] ${desc}`.substring(0, 1000),
                    source_url: 'https://free-for.dev',
                    source_type: 'free-for-dev',
                });
            }
        }

        console.log(`[Crawler] 🆓 free-for.dev: ${resources.length} recursos extraídos`);
        return resources.slice(0, 200);
    } catch (err) {
        console.error('[Crawler free-for.dev] Error:', err.message);
        return [];
    }
}

// ── Dispatcher principal ────────────────────────────────
async function crawlSource(source) {
    console.log(`[Crawler] 🔍 Crawleando: ${source.name} (${source.url})`);

    let results = [];

    if (source.url.includes('reddit.com')) {
        results = await crawlReddit(source.url);
    } else if (source.url.includes('free-for.dev') || source.url.includes('ripienaar/free-for-dev')) {
        results = await crawlFreeForDev(source.url);
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

    console.log(`[Crawler] ✅ ${results.length} recursos válidos de ${source.name}`);
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

                for (const resource of resources) {
                    await saveRawResource(resource);
                }

                // Backoff entre fuentes (respetar rate limits)
                await new Promise(resolve => setTimeout(resolve, 3000));
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
            [`Crawling completado: ${totalResources} recursos válidos`, JSON.stringify({ sources: sources.length, resources: totalResources })]
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
        if (!err.message.includes('duplicate')) {
            console.error('[Crawler] Error guardando recurso:', err.message);
        }
    }
}

module.exports = { crawlSource, runAllCrawlers, fetchPage };

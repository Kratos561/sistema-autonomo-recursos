const axios = require('axios');
const cheerio = require('cheerio');
const pool = require('../db/pool');

const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT_MS) || 15000;
const MAX_DEEP_DEPTH = parseInt(process.env.DEEP_CRAWL_DEPTH) || 3;

// URLs basura que NO son recursos tecnológicos reales
const JUNK_DOMAINS = [
    'i.redd.it', 'v.redd.it', 'preview.redd.it', 'i.imgur.com',
    'imgur.com', 'gfycat.com', 'giphy.com', 'youtube.com', 'youtu.be',
    'twitter.com', 'x.com', 'reddit.com', 'redd.it',
    'facebook.com', 'instagram.com', 'tiktok.com',
    'amazon.com', 'ebay.com', 'aliexpress.com',
    'linkedin.com', 'pinterest.com', 'medium.com',
    'docs.google.com', 'drive.google.com', 'play.google.com',
    'apps.apple.com', 'support.google.com',
];

// Extensiones de archivos que NO son recursos tech
const JUNK_EXTENSIONS = [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp',
    '.mp4', '.mov', '.avi', '.mp3', '.wav', '.pdf', '.zip', '.tar.gz',
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
    'ollama', 'vllm', 'text generation', 'transformers', 'machine learning',
    'tensorflow', 'self-hosted', 'open source', 'mlops', 'ml pipeline',
];

const HEADERS_LIST = [
    { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
    { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15' },
    { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0' },
];

function getRandomHeaders() {
    return { ...HEADERS_LIST[Math.floor(Math.random() * HEADERS_LIST.length)], 'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.5' };
}

// ══════════════════════════════════════════════
// 🔥 GLOBAL DEEP CRAWL TRACKER
// Evita visitar la misma URL dos veces en toda la sesión
// ══════════════════════════════════════════════
const globalVisited = new Set();
let deepCrawlStats = { level1: 0, level2: 0, level3: 0, total: 0 };

function resetDeepCrawlStats() {
    globalVisited.clear();
    deepCrawlStats = { level1: 0, level2: 0, level3: 0, total: 0 };
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
        // Solo logear si no es un timeout común
        if (!err.message.includes('timeout')) {
            console.error(`[Crawler] Error fetching ${url}:`, err.message?.substring(0, 80));
        }
        return null;
    }
}

// ══════════════════════════════════════════════════════════════
// 🔥 DEEP RESEARCH ENGINE — Nivel 2 y 3
// ══════════════════════════════════════════════════════════════

// ── Deep Crawl: Seguir un link y extraer SUB-RECURSOS ───
async function deepCrawlUrl(url, depth = 1, parentName = '') {
    if (depth > MAX_DEEP_DEPTH) return [];
    if (globalVisited.has(url)) return [];
    globalVisited.add(url);

    const depthLabel = depth === 1 ? '🟢 L1' : depth === 2 ? '🟡 L2' : '🔴 L3';
    console.log(`[DeepCrawl] ${depthLabel} Excavando: ${url.substring(0, 80)}...`);

    const resources = [];

    try {
        // ── Si es un repo de GitHub, extraer README profundo ──
        if (url.includes('github.com') && !url.includes('/blob/') && !url.includes('/tree/')) {
            const subResources = await deepCrawlGitHubRepo(url, depth, parentName);
            resources.push(...subResources);
        }
        // ── Si es un sitio web normal, extraer links tech ──
        else {
            const subResources = await deepCrawlWebPage(url, depth, parentName);
            resources.push(...subResources);
        }
    } catch (err) {
        console.error(`[DeepCrawl] Error en ${url}:`, err.message?.substring(0, 80));
    }

    // Contabilizar
    if (depth === 1) deepCrawlStats.level1 += resources.length;
    else if (depth === 2) deepCrawlStats.level2 += resources.length;
    else deepCrawlStats.level3 += resources.length;
    deepCrawlStats.total += resources.length;

    return resources;
}

// ── Deep Crawl: Repo de GitHub (seguir README links) ─────
async function deepCrawlGitHubRepo(url, depth, parentName) {
    const resources = [];

    try {
        const parts = new URL(url).pathname.split('/').filter(Boolean);
        if (parts.length < 2) return [];

        const owner = parts[0];
        const repo = parts[1];

        // 1. Intentar obtener info del repo vía API de GitHub
        let repoInfo = null;
        try {
            const apiResponse = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: { 'User-Agent': 'SentinelNexus/2.0', 'Accept': 'application/vnd.github.v3+json' },
                timeout: TIMEOUT,
            });
            repoInfo = apiResponse.data;
        } catch { /* API rate-limited, no pasa nada */ }

        // Guardar el repo como recurso principal con la descripción de GitHub
        const repoDescription = repoInfo?.description || '';
        const repoStars = repoInfo?.stargazers_count || 0;
        const repoTopics = repoInfo?.topics?.join(', ') || '';

        if (looksLikeTechResource(`${parentName} ${repo}`, `${repoDescription} ${repoTopics}`)) {
            resources.push({
                name: `${owner}/${repo}`,
                url: url,
                description: `⭐ ${repoStars} | ${repoDescription} | Topics: ${repoTopics}`.substring(0, 1000),
                source_url: url,
                source_type: 'github-deep',
            });
        }

        // 2. Descargar README y extraer TODOS los links (no solo los de fuera de GitHub!)
        let readme = '';
        try {
            const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`;
            const resp = await axios.get(readmeUrl, { headers: getRandomHeaders(), timeout: TIMEOUT });
            readme = resp.data;
        } catch {
            try {
                const readmeUrl = `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`;
                const resp = await axios.get(readmeUrl, { headers: getRandomHeaders(), timeout: TIMEOUT });
                readme = resp.data;
            } catch { /* Sin README */ }
        }

        if (readme) {
            const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
            let match;
            const seen = new Set();
            let linkCount = 0;

            while ((match = linkRegex.exec(readme)) !== null) {
                const linkName = match[1].trim();
                const linkUrl = match[2].trim();

                if (seen.has(linkUrl)) continue;
                if (!isValidResourceUrl(linkUrl) && !linkUrl.includes('github.com')) continue;
                if (linkName.length < 3) continue;
                seen.add(linkUrl);

                // ¡¡¡ AHORA SÍ SEGUIMOS LINKS DE GITHUB !!! (antes se ignoraban)
                if (looksLikeTechResource(linkName, '')) {
                    resources.push({
                        name: linkName.substring(0, 255),
                        url: linkUrl,
                        description: `Encontrado en README de ${owner}/${repo}`.substring(0, 1000),
                        source_url: url,
                        source_type: 'github-deep',
                    });
                    linkCount++;

                    // 🔥 RECURSIÓN NIVEL 2→3: Si es un link de GitHub, seguirlo también
                    if (linkUrl.includes('github.com') && depth < MAX_DEEP_DEPTH && linkCount <= 10) {
                        await new Promise(r => setTimeout(r, 1500)); // Rate limit
                        const subLinks = await deepCrawlUrl(linkUrl, depth + 1, linkName);
                        resources.push(...subLinks);
                    }
                }

                // Limitar para no ser bloqueados
                if (linkCount >= 50) break;
            }

            console.log(`[DeepCrawl] 📋 ${linkCount} links tech extraídos del README de ${owner}/${repo}`);
        }

        // 3. También extraer repos "relacionados" vía API de GitHub
        if (repoTopics && depth < MAX_DEEP_DEPTH) {
            try {
                const topicSearch = repoInfo?.topics?.slice(0, 2).join('+') || '';
                if (topicSearch) {
                    const searchResp = await axios.get(
                        `https://api.github.com/search/repositories?q=${topicSearch}+stars:>100&sort=stars&per_page=5`,
                        { headers: { 'User-Agent': 'SentinelNexus/2.0' }, timeout: TIMEOUT }
                    );
                    for (const item of searchResp.data?.items || []) {
                        if (globalVisited.has(item.html_url)) continue;
                        if (looksLikeTechResource(item.full_name, item.description || '')) {
                            resources.push({
                                name: item.full_name,
                                url: item.html_url,
                                description: `⭐ ${item.stargazers_count} | ${item.description || ''} | Topics: ${(item.topics || []).join(', ')}`.substring(0, 1000),
                                source_url: url,
                                source_type: 'github-related',
                            });
                        }
                    }
                }
            } catch { /* API limit, no pasa nada */ }
        }
    } catch (err) {
        console.error(`[DeepCrawl GitHub] Error en ${url}:`, err.message?.substring(0, 80));
    }

    return resources;
}

// ── Deep Crawl: Página web genérica (extraer sub-links) ──
async function deepCrawlWebPage(url, depth, parentName) {
    const resources = [];

    try {
        const result = await fetchPage(url);
        if (!result) return [];

        const $ = cheerio.load(result.html);
        const seen = new Set();
        let linkCount = 0;

        // Extraer TÍTULO de la página para contexto
        const pageTitle = $('title').first().text().trim() || '';
        const pageDesc = $('meta[name="description"]').attr('content') || '';

        // Extraer TODOS los links de la página
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            const linkText = $(el).text().trim();

            if (!href || !linkText || linkText.length < 3) return;

            let fullUrl = href;
            if (!href.startsWith('http')) {
                try { fullUrl = new URL(href, url).toString(); } catch { return; }
            }

            if (seen.has(fullUrl)) return;
            if (!isValidResourceUrl(fullUrl) && !fullUrl.includes('github.com')) return;

            const context = `${linkText} ${$(el).attr('title') || ''} ${pageTitle}`;
            if (looksLikeTechResource(context, pageDesc)) {
                seen.add(fullUrl);

                // Extraer contexto circundante del link
                const surrounding = $(el).closest('li, div, article, tr, p').text().trim().substring(0, 500);

                resources.push({
                    name: linkText.substring(0, 255),
                    url: fullUrl,
                    description: `${surrounding}`.substring(0, 1000),
                    source_url: url,
                    source_type: `web-deep-L${depth}`,
                });
                linkCount++;
            }
        });

        // 🔥 NIVEL 3: Seguir links internos de la página que parezcan categorías/listas
        if (depth < MAX_DEEP_DEPTH && linkCount > 0) {
            const internalLinks = [];
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim().toLowerCase();
                if (!href) return;

                let fullUrl = href;
                if (!href.startsWith('http')) {
                    try { fullUrl = new URL(href, url).toString(); } catch { return; }
                }

                // Seguir links que parezcan categorías, listas o secciones de recursos
                const isDeepWorthy = ['gpu', 'compute', 'free', 'pricing', 'resources', 'tools',
                    'awesome', 'alternatives', 'open-source', 'self-hosted', 'infrastructure',
                    'cloud', 'credits', 'grants', 'deploy', 'docker', 'notebook'].some(kw =>
                        text.includes(kw) || fullUrl.toLowerCase().includes(kw)
                    );

                if (isDeepWorthy && !globalVisited.has(fullUrl) && isValidResourceUrl(fullUrl)) {
                    internalLinks.push(fullUrl);
                }
            });

            // Seguir máximo 5 sub-links por página
            for (const link of internalLinks.slice(0, 5)) {
                await new Promise(r => setTimeout(r, 2000)); // Rate limit
                const subResources = await deepCrawlUrl(link, depth + 1, pageTitle);
                resources.push(...subResources);
            }
        }

        console.log(`[DeepCrawl Web] 🌐 ${linkCount} links tech en ${url.substring(0, 60)}`);
    } catch (err) {
        console.error(`[DeepCrawl Web] Error:`, err.message?.substring(0, 80));
    }

    return resources;
}

// ══════════════════════════════════════════════════════════════
// CRAWLERS CLÁSICOS (Nivel 1) — Ahora con Deep Research
// ══════════════════════════════════════════════════════════════

// ── Crawler para Reddit JSON API ────────────────────────
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

            // PRIORIDAD 1: Link externo directo del post
            if (data.url && !data.is_self && isValidResourceUrl(data.url)) {
                resources.push({
                    name: data.title.substring(0, 255),
                    url: data.url,
                    description: (data.selftext || '').substring(0, 1000),
                    source_url: `https://reddit.com${data.permalink}`,
                    source_type: 'reddit',
                });

                // 🔥 DEEP: Seguir el link externo al Nivel 2
                if (data.url.includes('github.com')) {
                    await new Promise(r => setTimeout(r, 2000));
                    const deepResources = await deepCrawlUrl(data.url, 2, data.title);
                    resources.push(...deepResources);
                }
                continue;
            }

            // PRIORIDAD 2: Extraer URLs del cuerpo del post (selftext)
            if (data.selftext) {
                const urlRegex = /https?:\/\/[^\s\)\]\>,\"]+/g;
                const foundUrls = data.selftext.match(urlRegex) || [];

                for (const foundUrl of foundUrls) {
                    const cleanUrl = foundUrl.replace(/[.,;:!?)]+$/, '');
                    if (isValidResourceUrl(cleanUrl) || cleanUrl.includes('github.com')) {
                        resources.push({
                            name: data.title.substring(0, 255),
                            url: cleanUrl,
                            description: (data.selftext || '').substring(0, 1000),
                            source_url: `https://reddit.com${data.permalink}`,
                            source_type: 'reddit',
                        });

                        // 🔥 DEEP: Seguir links de GitHub al Nivel 2
                        if (cleanUrl.includes('github.com') && !globalVisited.has(cleanUrl)) {
                            await new Promise(r => setTimeout(r, 2000));
                            const deepResources = await deepCrawlUrl(cleanUrl, 2, data.title);
                            resources.push(...deepResources);
                        }
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

// ── Crawler para GitHub ────────────────────────────────
async function crawlGitHub(url) {
    try {
        if (url.includes('/trending') || url.includes('/topics')) {
            return await crawlGitHubHTML(url);
        }
        if (url.includes('public-apis/public-apis') || url.includes('free-for')) {
            return await crawlResourceList(url);
        }
        return await crawlGitHubHTML(url);
    } catch (err) {
        console.error('[Crawler GitHub] Error:', err.message);
        return [];
    }
}

// Crawl GitHub trending/topics page + DEEP RESEARCH en cada repo
async function crawlGitHubHTML(url) {
    try {
        const result = await fetchPage(url);
        if (!result) return [];

        const $ = cheerio.load(result.html);
        const resources = [];
        const seen = new Set();

        $('article.Box-row h2 a, h3 a[href*="/"]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href || seen.has(href)) return;

            const fullUrl = `https://github.com${href}`;
            const name = $(el).text().trim().replace(/\s+/g, ' ');

            if (name && href.split('/').length >= 3) {
                seen.add(href);
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

        const level1 = resources.slice(0, 30);

        // 🔥 DEEP RESEARCH: Seguir CADA repo al Nivel 2
        const allResources = [...level1];
        let deepCount = 0;
        for (const resource of level1) {
            if (deepCount >= 10) break; // Max 10 repos profundos por fuente
            if (looksLikeTechResource(resource.name, resource.description)) {
                await new Promise(r => setTimeout(r, 2000)); // Rate limit
                const deepResources = await deepCrawlUrl(resource.url, 2, resource.name);
                allResources.push(...deepResources);
                deepCount++;
            }
        }

        return allResources;
    } catch (err) {
        console.error('[Crawler GitHub HTML] Error:', err.message);
        return [];
    }
}

// Crawl listas "awesome-x" — AHORA SIGUE LINKS DE GITHUB 🔥
async function crawlResourceList(url) {
    try {
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

        const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
        let match;
        let deepFollowed = 0;

        while ((match = linkRegex.exec(readme)) !== null) {
            const name = match[1].trim();
            const linkUrl = match[2].trim();

            if (seen.has(linkUrl)) continue;
            if (name.length < 3) continue;

            // 🔥 CAMBIO CRÍTICO: YA NO IGNORAMOS LINKS DE GITHUB
            // Antes: if (linkUrl.includes('github.com')) continue; ← ESTO MATABA TODO
            if (!isValidResourceUrl(linkUrl) && !linkUrl.includes('github.com')) continue;

            seen.add(linkUrl);
            resources.push({
                name: name.substring(0, 255),
                url: linkUrl,
                description: '',
                source_url: url,
                source_type: 'github-list',
            });

            // 🔥 DEEP RESEARCH: Seguir repos de GitHub encontrados en listas awesome
            if (linkUrl.includes('github.com') && deepFollowed < 8 && looksLikeTechResource(name, '')) {
                await new Promise(r => setTimeout(r, 2000));
                const deepResources = await deepCrawlUrl(linkUrl, 2, name);
                resources.push(...deepResources);
                deepFollowed++;
            }
        }

        console.log(`[Crawler] 📋 Extraídos ${resources.length} links (${deepFollowed} deep-followed) de lista: ${url}`);
        return resources.slice(0, 200);
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

// ── Crawler para free-for.dev + DEEP ───────────────────
async function crawlFreeForDev(url) {
    try {
        const readmeUrl = 'https://raw.githubusercontent.com/ripienaar/free-for-dev/master/README.md';
        const response = await axios.get(readmeUrl, { headers: getRandomHeaders(), timeout: TIMEOUT });
        const readme = response.data;
        const resources = [];
        const seen = new Set();

        const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
        let match;
        let currentSection = 'general';

        const lines = readme.split('\n');
        for (const line of lines) {
            const sectionMatch = line.match(/^##\s+(.+)/);
            if (sectionMatch) {
                currentSection = sectionMatch[1].trim().toLowerCase();
                continue;
            }

            linkRegex.lastIndex = 0;
            while ((match = linkRegex.exec(line)) !== null) {
                const name = match[1].trim();
                const linkUrl = match[2].trim();

                if (seen.has(linkUrl)) continue;
                if (!isValidResourceUrl(linkUrl)) continue;
                // 🔥 YA NO IGNORAMOS LINKS DE GITHUB
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

// ══════════════════════════════════════════════════════════════
// 🔥 NUEVO: Crawler de Hacker News (Comments Deep Mining)
// ══════════════════════════════════════════════════════════════
async function crawlHackerNews() {
    const resources = [];
    try {
        // Buscar historias recientes sobre GPU/ML/free compute
        const queries = ['free gpu', 'colab notebook', 'self-hosted llm', 'gpu cloud free'];

        for (const query of queries) {
            try {
                const searchUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`;
                const resp = await axios.get(searchUrl, { timeout: TIMEOUT });

                for (const hit of resp.data?.hits || []) {
                    const storyUrl = hit.url;
                    if (!storyUrl || !isValidResourceUrl(storyUrl)) continue;
                    if (globalVisited.has(storyUrl)) continue;

                    resources.push({
                        name: (hit.title || '').substring(0, 255),
                        url: storyUrl,
                        description: `HN ${hit.points} points | ${hit.num_comments} comments`.substring(0, 1000),
                        source_url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
                        source_type: 'hackernews',
                    });

                    // 🔥 DEEP: Seguir el link al Nivel 2
                    if (storyUrl.includes('github.com')) {
                        await new Promise(r => setTimeout(r, 2000));
                        const deepResources = await deepCrawlUrl(storyUrl, 2, hit.title);
                        resources.push(...deepResources);
                    }
                }
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                console.error(`[HN] Error buscando "${query}":`, e.message?.substring(0, 60));
            }
        }

        console.log(`[Crawler] 🟠 HackerNews: ${resources.length} recursos extraídos`);
    } catch (err) {
        console.error('[Crawler HN] Error:', err.message);
    }
    return resources;
}

// ══════════════════════════════════════════════════════════════
// 🌐 GOOGLE SEARCH — Scraping via Google HTML
// ══════════════════════════════════════════════════════════════
async function crawlGoogle() {
    const resources = [];
    const queries = [
        'free GPU cloud computing 2025 2026',
        'free colab alternative GPU notebook',
        'free NVIDIA GPU credits developers',
        'serverless GPU inference free tier',
        'free A100 H100 cloud access',
        'docker GPU nvidia free hosting',
        'compute grants open source AI ML',
        'free deep learning training cloud',
        'google colab keep alive bypass timeout',
        'self hosted LLM free GPU',
        'free cloud GPU jupyter notebook',
        'oracle cloud free tier GPU ARM',
    ];

    for (const query of queries) {
        try {
            const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=15&hl=en`;
            const result = await fetchPage(searchUrl);
            if (!result) continue;

            const $ = cheerio.load(result.html);
            const seen = new Set();

            // Extraer resultados de búsqueda de Google
            $('a[href]').each((_, el) => {
                const href = $(el).attr('href') || '';

                // Google wraps links in /url?q=REAL_URL&... format
                let realUrl = href;
                if (href.includes('/url?q=')) {
                    const match = href.match(/\/url\?q=(https?[^&]+)/);
                    if (match) realUrl = decodeURIComponent(match[1]);
                }

                if (!realUrl.startsWith('http')) return;
                if (seen.has(realUrl)) return;
                if (!isValidResourceUrl(realUrl) && !realUrl.includes('github.com')) return;
                // Skip Google's own pages
                if (realUrl.includes('google.com') || realUrl.includes('googleapis.com')) return;
                if (realUrl.includes('webcache.googleusercontent.com')) return;

                seen.add(realUrl);

                const title = $(el).text().trim();
                if (title.length < 5) return;

                const parentText = $(el).closest('div').text().trim().substring(0, 500);

                resources.push({
                    name: title.substring(0, 255),
                    url: realUrl,
                    description: `[Google: "${query}"] ${parentText}`.substring(0, 1000),
                    source_url: searchUrl,
                    source_type: 'google',
                });
            });

            console.log(`[Google] 🔍 "${query}" → ${seen.size} resultados`);
            await new Promise(r => setTimeout(r, 3000)); // Anti-ban: 3s entre búsquedas
        } catch (err) {
            console.error(`[Google] Error buscando "${query}":`, err.message?.substring(0, 60));
        }
    }

    // Deep follow GitHub links encontrados via Google
    let deepFollowed = 0;
    for (const r of resources) {
        if (deepFollowed >= 8) break;
        if (r.url.includes('github.com') && looksLikeTechResource(r.name, r.description)) {
            await new Promise(res => setTimeout(res, 2000));
            const deepResources = await deepCrawlUrl(r.url, 2, r.name);
            resources.push(...deepResources);
            deepFollowed++;
        }
    }

    console.log(`[Crawler] 🌐 Google: ${resources.length} recursos extraídos`);
    return resources;
}

// ══════════════════════════════════════════════════════════════
// 🦆 DUCKDUCKGO SEARCH — HTML Scraping (sin API key)
// ══════════════════════════════════════════════════════════════
async function crawlDuckDuckGo() {
    const resources = [];
    const queries = [
        'free GPU cloud notebook colab alternative',
        'free NVIDIA credits compute startup',
        'self-hosted LLM free GPU inference',
        'docker nvidia GPU container free',
        'free compute grants AI research',
        'colab keepalive bypass timeout script',
        'vast.ai runpod lambda GPU free tier',
        'free cloud GPU training deep learning',
    ];

    for (const query of queries) {
        try {
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: TIMEOUT,
            });

            const $ = cheerio.load(response.data);
            const seen = new Set();

            $('.result__a').each((_, el) => {
                let href = $(el).attr('href') || '';

                // DDG wraps links with uddg parameter
                if (href.includes('uddg=')) {
                    const match = href.match(/uddg=(https?[^&]+)/);
                    if (match) href = decodeURIComponent(match[1]);
                }

                if (!href.startsWith('http')) return;
                if (seen.has(href)) return;
                if (!isValidResourceUrl(href) && !href.includes('github.com')) return;

                seen.add(href);
                const title = $(el).text().trim();
                const snippet = $(el).closest('.result').find('.result__snippet').text().trim();

                if (title.length < 5) return;
                resources.push({
                    name: title.substring(0, 255),
                    url: href,
                    description: `[DDG: "${query}"] ${snippet}`.substring(0, 1000),
                    source_url: searchUrl,
                    source_type: 'duckduckgo',
                });
            });

            console.log(`[DDG] 🦆 "${query}" → ${seen.size} resultados`);
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            console.error(`[DDG] Error buscando "${query}":`, err.message?.substring(0, 60));
        }
    }

    console.log(`[Crawler] 🦆 DuckDuckGo: ${resources.length} recursos extraídos`);
    return resources;
}

// ══════════════════════════════════════════════════════════════
// 📚 STACK OVERFLOW — API Pública (sin key para básico)
// ══════════════════════════════════════════════════════════════
async function crawlStackOverflow() {
    const resources = [];
    const queries = [
        'free GPU cloud',
        'google colab keep alive',
        'nvidia docker GPU',
        'free compute credits',
        'serverless GPU inference',
    ];

    for (const query of queries) {
        try {
            const apiUrl = `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q=${encodeURIComponent(query)}&site=stackoverflow&pagesize=10&filter=withbody`;
            const response = await axios.get(apiUrl, {
                timeout: TIMEOUT,
                headers: { 'Accept-Encoding': 'gzip, deflate' },
                decompress: true,
            });

            for (const item of response.data?.items || []) {
                // Extraer links de las respuestas
                const bodyText = (item.body || '').replace(/<[^>]+>/g, ' ');
                const urlRegex = /https?:\/\/[^\s<>"']+/g;
                const foundUrls = bodyText.match(urlRegex) || [];

                for (const foundUrl of foundUrls) {
                    const cleanUrl = foundUrl.replace(/[.,;:!?)]+$/, '');
                    if (!isValidResourceUrl(cleanUrl) && !cleanUrl.includes('github.com')) continue;
                    if (globalVisited.has(cleanUrl)) continue;

                    if (looksLikeTechResource(item.title, cleanUrl)) {
                        resources.push({
                            name: (item.title || '').substring(0, 255),
                            url: cleanUrl,
                            description: `SO ⬆${item.score} | ${bodyText.substring(0, 300)}`.substring(0, 1000),
                            source_url: item.link || '',
                            source_type: 'stackoverflow',
                        });
                    }
                }
            }

            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error(`[SO] Error buscando "${query}":`, err.message?.substring(0, 60));
        }
    }

    console.log(`[Crawler] 📚 StackOverflow: ${resources.length} recursos extraídos`);
    return resources;
}

// ══════════════════════════════════════════════════════════════
// 📝 DEV.TO — API Pública (sin key)
// ══════════════════════════════════════════════════════════════
async function crawlDevTo() {
    const resources = [];
    const tags = ['gpu', 'colab', 'deeplearning', 'machinelearning', 'docker', 'nvidia', 'llm', 'selfhosted', 'ai', 'freecloud'];

    for (const tag of tags) {
        try {
            const apiUrl = `https://dev.to/api/articles?tag=${tag}&top=30&per_page=15`;
            const response = await axios.get(apiUrl, {
                headers: { 'User-Agent': 'SentinelNexus/2.0' },
                timeout: TIMEOUT,
            });

            for (const article of response.data || []) {
                // El artículo en sí puede ser un recurso
                if (looksLikeTechResource(article.title || '', article.description || '')) {
                    resources.push({
                        name: (article.title || '').substring(0, 255),
                        url: article.url || article.canonical_url || '',
                        description: `Dev.to ❤${article.positive_reactions_count || 0} | ${(article.description || '').substring(0, 400)}`.substring(0, 1000),
                        source_url: article.url || '',
                        source_type: 'devto',
                    });
                }
            }
            await new Promise(r => setTimeout(r, 500));
        } catch (err) {
            console.error(`[Dev.to] Error tag "${tag}":`, err.message?.substring(0, 60));
        }
    }

    console.log(`[Crawler] 📝 Dev.to: ${resources.length} recursos extraídos`);
    return resources;
}

// ══════════════════════════════════════════════════════════════
// 🦊 GITLAB — API Pública (sin key)
// ══════════════════════════════════════════════════════════════
async function crawlGitLab() {
    const resources = [];
    const queries = ['free gpu', 'colab notebook', 'nvidia docker', 'deep learning', 'llm inference', 'gpu cloud'];

    for (const query of queries) {
        try {
            const apiUrl = `https://gitlab.com/api/v4/projects?search=${encodeURIComponent(query)}&order_by=stars&sort=desc&per_page=10`;
            const response = await axios.get(apiUrl, {
                headers: { 'User-Agent': 'SentinelNexus/2.0' },
                timeout: TIMEOUT,
            });

            for (const project of response.data || []) {
                const desc = project.description || '';
                if (looksLikeTechResource(project.name || '', desc)) {
                    resources.push({
                        name: (project.path_with_namespace || project.name || '').substring(0, 255),
                        url: project.web_url || '',
                        description: `GitLab ⭐${project.star_count || 0} 🍴${project.forks_count || 0} | ${desc}`.substring(0, 1000),
                        source_url: project.web_url || '',
                        source_type: 'gitlab',
                    });
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error(`[GitLab] Error buscando "${query}":`, err.message?.substring(0, 60));
        }
    }

    console.log(`[Crawler] 🦊 GitLab: ${resources.length} recursos extraídos`);
    return resources;
}

// ══════════════════════════════════════════════════════════════
// 🤗 HUGGING FACE — API Pública (Models & Spaces)
// ══════════════════════════════════════════════════════════════
async function crawlHuggingFace() {
    const resources = [];

    // Buscar modelos trending de inferencia gratuita
    try {
        const modelsUrl = 'https://huggingface.co/api/models?sort=trending&limit=20&pipeline_tag=text-generation';
        const resp = await axios.get(modelsUrl, { timeout: TIMEOUT });

        for (const model of resp.data || []) {
            resources.push({
                name: (model.modelId || model.id || '').substring(0, 255),
                url: `https://huggingface.co/${model.modelId || model.id}`,
                description: `HF Model 📥${model.downloads || 0} ❤${model.likes || 0} | Pipeline: ${model.pipeline_tag || 'N/A'} | Tags: ${(model.tags || []).slice(0, 5).join(', ')}`.substring(0, 1000),
                source_url: 'https://huggingface.co/models',
                source_type: 'huggingface',
            });
        }
    } catch (err) {
        console.error('[HF Models] Error:', err.message?.substring(0, 60));
    }

    // Buscar Spaces trending (muchos ofrecen inferencia gratuita)
    try {
        const spacesUrl = 'https://huggingface.co/api/spaces?sort=trending&limit=20';
        const resp = await axios.get(spacesUrl, { timeout: TIMEOUT });

        for (const space of resp.data || []) {
            const spaceId = space.id || '';
            if (looksLikeTechResource(spaceId, '')) {
                resources.push({
                    name: spaceId.substring(0, 255),
                    url: `https://huggingface.co/spaces/${spaceId}`,
                    description: `HF Space ❤${space.likes || 0} | SDK: ${space.sdk || 'N/A'} | Runtime: ${space.runtime?.hardware || 'cpu'}`.substring(0, 1000),
                    source_url: 'https://huggingface.co/spaces',
                    source_type: 'huggingface-space',
                });
            }
        }
    } catch (err) {
        console.error('[HF Spaces] Error:', err.message?.substring(0, 60));
    }

    // Buscar modelos específicamente GPU-friendly
    const gpuQueries = ['gguf', 'quantized', 'gpu', 'inference'];
    for (const q of gpuQueries) {
        try {
            const url = `https://huggingface.co/api/models?search=${q}&sort=downloads&limit=10`;
            const resp = await axios.get(url, { timeout: TIMEOUT });
            for (const model of resp.data || []) {
                if (!globalVisited.has(model.modelId)) {
                    resources.push({
                        name: (model.modelId || '').substring(0, 255),
                        url: `https://huggingface.co/${model.modelId}`,
                        description: `HF ${q} 📥${model.downloads || 0} | Tags: ${(model.tags || []).slice(0, 5).join(', ')}`.substring(0, 1000),
                        source_url: 'https://huggingface.co',
                        source_type: 'huggingface',
                    });
                }
            }
            await new Promise(r => setTimeout(r, 500));
        } catch (err) { /* skip */ }
    }

    console.log(`[Crawler] 🤗 HuggingFace: ${resources.length} recursos extraídos`);
    return resources;
}

// ══════════════════════════════════════════════════════════════
// 🦞 LOBSTE.RS — API JSON nativa
// ══════════════════════════════════════════════════════════════
async function crawlLobsters() {
    const resources = [];
    const tags = ['ai', 'ml', 'devops', 'distributed'];

    for (const tag of tags) {
        try {
            const apiUrl = `https://lobste.rs/t/${tag}.json`;
            const resp = await axios.get(apiUrl, { timeout: TIMEOUT });

            for (const story of resp.data || []) {
                if (!story.url || !isValidResourceUrl(story.url)) continue;
                if (looksLikeTechResource(story.title || '', story.description || '')) {
                    resources.push({
                        name: (story.title || '').substring(0, 255),
                        url: story.url,
                        description: `Lobste.rs ⬆${story.score || 0} 💬${story.comment_count || 0} | Tags: ${(story.tags || []).join(', ')}`.substring(0, 1000),
                        source_url: story.short_id_url || `https://lobste.rs`,
                        source_type: 'lobsters',
                    });
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error(`[Lobsters] Error tag "${tag}":`, err.message?.substring(0, 60));
        }
    }

    console.log(`[Crawler] 🦞 Lobste.rs: ${resources.length} recursos extraídos`);
    return resources;
}

// ══════════════════════════════════════════════════════════════
// 🔍 GITHUB CODE SEARCH — Buscar archivos/código específico
// ══════════════════════════════════════════════════════════════
async function crawlGitHubCodeSearch() {
    const resources = [];
    const queries = [
        'colab+keep+alive+script',
        'free+gpu+inference+api',
        'nvidia+docker+compose+gpu',
        'ollama+deploy+free',
        'runpod+serverless+free',
    ];

    for (const query of queries) {
        try {
            const apiUrl = `https://api.github.com/search/repositories?q=${query}+stars:>50&sort=stars&per_page=10`;
            const resp = await axios.get(apiUrl, {
                headers: { 'User-Agent': 'SentinelNexus/2.0', 'Accept': 'application/vnd.github.v3+json' },
                timeout: TIMEOUT,
            });

            for (const repo of resp.data?.items || []) {
                if (globalVisited.has(repo.html_url)) continue;
                resources.push({
                    name: (repo.full_name || '').substring(0, 255),
                    url: repo.html_url,
                    description: `GH Search ⭐${repo.stargazers_count} 🍴${repo.forks_count} | ${(repo.description || '').substring(0, 300)} | Topics: ${(repo.topics || []).join(', ')}`.substring(0, 1000),
                    source_url: 'https://github.com/search',
                    source_type: 'github-search',
                });
            }
            await new Promise(r => setTimeout(r, 2000)); // GitHub API rate limit
        } catch (err) {
            console.error(`[GH Search] Error "${query}":`, err.message?.substring(0, 60));
        }
    }

    console.log(`[Crawler] 🔍 GitHub Code Search: ${resources.length} recursos extraídos`);
    return resources;
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
    } else if (source.url.includes('hn.algolia.com') || source.name?.toLowerCase().includes('hacker news')) {
        results = await crawlHackerNews();
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
    // Reset global tracking para nueva sesión
    resetDeepCrawlStats();

    try {
        const { rows: sources } = await pool.query(
            `SELECT * FROM crawl_sources WHERE is_active = true ORDER BY last_crawled ASC NULLS FIRST`
        );

        console.log(`[Crawler] Iniciando crawling de ${sources.length} fuentes DB + 8 plataformas extra (DEEP RESEARCH MODE: Max Nivel ${MAX_DEEP_DEPTH})...`);
        let totalResources = 0;

        // ══════════════════════════════════════════════
        // FASE 1: Fuentes de la base de datos (las originales)
        // ══════════════════════════════════════════════
        for (const source of sources) {
            try {
                const resources = await crawlSource(source);
                totalResources += resources.length;
                for (const resource of resources) {
                    await saveRawResource(resource);
                }
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (err) {
                console.error(`[Crawler] Error en ${source.name}:`, err.message);
                await pool.query(
                    `UPDATE crawl_sources SET success_rate = GREATEST(success_rate - 5, 0) WHERE id = $1`,
                    [source.id]
                );
            }
        }

        // ══════════════════════════════════════════════
        // FASE 2: Plataformas EXTRA hardcodeadas (el arsenal completo)
        // ══════════════════════════════════════════════
        const bonusCrawlers = [
            { name: '🟠 HackerNews', fn: crawlHackerNews },
            { name: '🌐 Google Search', fn: crawlGoogle },
            { name: '🦆 DuckDuckGo', fn: crawlDuckDuckGo },
            { name: '📚 StackOverflow', fn: crawlStackOverflow },
            { name: '📝 Dev.to', fn: crawlDevTo },
            { name: '🦊 GitLab', fn: crawlGitLab },
            { name: '🤗 HuggingFace', fn: crawlHuggingFace },
            { name: '🦞 Lobste.rs', fn: crawlLobsters },
            { name: '🔍 GitHub Code Search', fn: crawlGitHubCodeSearch },
        ];

        for (const crawler of bonusCrawlers) {
            try {
                console.log(`[Crawler] ${crawler.name}: Ejecutando crawler extra...`);
                const resources = await crawler.fn();
                for (const resource of resources) {
                    await saveRawResource(resource);
                }
                totalResources += resources.length;
                console.log(`[Crawler] ${crawler.name}: ✅ ${resources.length} recursos`);
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                console.error(`[Crawler] ${crawler.name}: ❌ Error:`, err.message?.substring(0, 80));
            }
        }

        // Estadísticas DEEP
        console.log(`\n🔥 DEEP RESEARCH STATS:`);
        console.log(`  → Nivel 1 (Superficie): ${deepCrawlStats.level1} recursos`);
        console.log(`  → Nivel 2 (Sub-links):  ${deepCrawlStats.level2} recursos`);
        console.log(`  → Nivel 3 (Profundo):   ${deepCrawlStats.level3} recursos`);
        console.log(`  → Total Deep:           ${deepCrawlStats.total} recursos extras`);
        console.log(`  → TOTAL GLOBAL:         ${totalResources} recursos\n`);

        await pool.query(
            `INSERT INTO system_log (module, action, status, message, metadata)
       VALUES ('crawler', 'run_all', 'success', $1, $2)`,
            [
                `MEGA Crawling completado: ${totalResources} recursos (L2: ${deepCrawlStats.level2}, L3: ${deepCrawlStats.level3})`,
                JSON.stringify({ sources: sources.length, bonusPlatforms: bonusCrawlers.length, resources: totalResources, deep: deepCrawlStats })
            ]
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

module.exports = { crawlSource, runAllCrawlers, fetchPage, deepCrawlUrl };

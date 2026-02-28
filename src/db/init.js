const pool = require('./pool');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
    const client = await pool.connect();
    try {
        console.log('[DB] Inicializando esquema de base de datos...');
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        await client.query(schema);
        console.log('[DB] ✅ Esquema inicializado correctamente');

        // Migración: agregar columnas nuevas si no existen
        const migrations = [
            `ALTER TABLE resources ADD COLUMN IF NOT EXISTS telegram_notified_at TIMESTAMP`,
            `ALTER TABLE resources ADD COLUMN IF NOT EXISTS last_ai_analysis TIMESTAMP`,
            `ALTER TABLE resources ADD COLUMN IF NOT EXISTS notification_hash TEXT`,
        ];
        for (const m of migrations) {
            try { await client.query(m); } catch (e) { /* ya existe */ }
        }
        console.log('[DB] ✅ Migraciones aplicadas');

        // Insertar fuentes de crawling iniciales
        const sources = [
            { name: 'GitHub Topics - Free APIs', url: 'https://github.com/topics/free-api', type: 'github' },
            { name: 'GitHub - public-apis', url: 'https://github.com/public-apis/public-apis', type: 'github' },
            { name: 'Free for Dev', url: 'https://free-for.dev/', type: 'aggregator' },
            { name: 'Product Hunt - Developer Tools', url: 'https://www.producthunt.com/topics/developer-tools', type: 'aggregator' },
            { name: 'Hacker News - Show HN', url: 'https://news.ycombinator.com/show', type: 'forum' },
            { name: 'Reddit - r/selfhosted', url: 'https://www.reddit.com/r/selfhosted/top/.json?t=week', type: 'forum' },
            { name: 'Reddit - r/webdev', url: 'https://www.reddit.com/r/webdev/top/.json?t=week', type: 'forum' },
            { name: 'AlternativeTo - Free', url: 'https://alternativeto.net/platform/online/?license=free', type: 'aggregator' },
            { name: 'Dev.to - Free Resources', url: 'https://dev.to/t/free', type: 'blog' },
            { name: 'GitHub Trending', url: 'https://github.com/trending', type: 'github' },
        ];

        for (const src of sources) {
            await client.query(
                `INSERT INTO crawl_sources (name, url, source_type)
         VALUES ($1, $2, $3)
         ON CONFLICT (url) DO NOTHING`,
                [src.name, src.url, src.type]
            );
        }
        console.log(`[DB] ✅ ${sources.length} fuentes de crawling registradas`);

        await client.query(
            `INSERT INTO system_log (module, action, status, message)
       VALUES ('init', 'database_setup', 'success', 'Esquema y fuentes iniciales creados')`
        );

        return true;
    } catch (err) {
        console.error('[DB] ❌ Error al inicializar:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { initDatabase };

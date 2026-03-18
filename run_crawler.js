require('dotenv').config();
const { runPipeline } = require('./src/modules/scheduler');
const pool = require('./src/db/pool');

async function main() {
    console.log('==================================================');
    console.log('[SENTINEL] Iniciando rastreo profundo desde GITHUB ACTIONS...');
    console.log('==================================================');
    try {
        const results = await runPipeline('github_action_cron');
        console.log('[SENTINEL] Operación completada con éxito.');
        console.log(JSON.stringify(results, null, 2));
        
        // Cierra el pool para que el proceso de Node.js termine
        await pool.end();
        process.exit(0);
    } catch (err) {
        console.error('[SENTINEL] Error crítico durante la ejecución:', err);
        process.exit(1);
    }
}

main();

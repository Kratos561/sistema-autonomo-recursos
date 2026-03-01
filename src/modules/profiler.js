const axios = require('axios');
const pool = require('../db/pool');

/**
 * Módulo Profiler de Latencia HFT (Latency-God Engine)
 * Mide empíricamente el tiempo de respuesta (TTFB aprox) de los recursos descubiertos.
 */

async function measureLatency(url) {
    try {
        const start = Date.now();
        // Usamos un ligero timeout y solo traemos los headers/stream para no descargar el cuerpo completo si es pesado.
        await axios.get(url, {
            timeout: 5000,
            validateStatus: () => true, // Cualquier status es válido para medir latencia de red
            responseType: 'stream',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sentinel/2.0' }
        });
        const latency = Date.now() - start;
        return latency;
    } catch (error) {
        // Timeout, DNS error, or unreachable
        return -1;
    }
}

async function runProfiler() {
    console.log('[Profiler] ⚡ Iniciando Latency-God Engine...');

    // Obtener recursos que no tienen medición de latencia
    const { rows } = await pool.query(`
        SELECT id, url 
        FROM resources 
        WHERE latency_ms IS NULL 
          AND status != 'dead'
        LIMIT 50
    `);

    if (rows.length === 0) {
        console.log('[Profiler] ⚡ Ningún recurso pendiente de medición.');
        return 0;
    }

    let measuredCount = 0;
    for (const resource of rows) {
        process.stdout.write(`[Profiler] Midiendo ${resource.url.substring(0, 50)}... `);
        const latency = await measureLatency(resource.url);

        await pool.query(
            `UPDATE resources SET latency_ms = $1 WHERE id = $2`,
            [latency === -1 ? null : latency, resource.id] // Guardamos null o el valor
        );

        if (latency !== -1) {
            console.log(`${latency}ms`);
            measuredCount++;
        } else {
            console.log(`❌ Inaccesible / Timeout`);
        }
    }

    console.log(`[Profiler] ⚡ Completado. ${measuredCount}/${rows.length} recursos medidos exitosamente.`);
    return measuredCount;
}

module.exports = {
    runProfiler
};

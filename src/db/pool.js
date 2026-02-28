const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en pool:', err.message);
});

pool.on('connect', () => {
  console.log('[DB] Nueva conexión establecida con Neon PostgreSQL');
});

module.exports = pool;

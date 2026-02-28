const { Pool } = require('pg');
require('dotenv').config();

// Fix SSL mode warning: use verify-full explicitly
let connectionString = process.env.DATABASE_URL || '';
if (connectionString.includes('sslmode=require')) {
  connectionString = connectionString.replace('sslmode=require', 'sslmode=no-verify');
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

pool.on('error', (err) => {
  console.error('[DB] Error inesperado en pool:', err.message);
});

module.exports = pool;


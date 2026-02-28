require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { initDatabase } = require('./src/db/init');
const { startScheduler } = require('./src/modules/scheduler');
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Archivos estáticos (Dashboard) ──────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──────────────────────────────────────────
app.use('/api', apiRoutes);

// ── SPA Fallback ────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Error Handler ───────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('[Server] Error:', err.message);
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
});

// ── Start ───────────────────────────────────────────────
async function start() {
    try {
        console.log('══════════════════════════════════════════════');
        console.log('🛰️  Sistema Autónomo de Descubrimiento');
        console.log('   de Recursos Tecnológicos Gratuitos');
        console.log('══════════════════════════════════════════════\n');

        // Inicializar base de datos
        await initDatabase();

        // Iniciar servidor HTTP
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n[Server] 🌐 Dashboard: http://localhost:${PORT}`);
            console.log(`[Server] 📡 API:       http://localhost:${PORT}/api`);
            console.log(`[Server] 💊 Health:    http://localhost:${PORT}/api/health\n`);
        });

        // Iniciar scheduler automático
        startScheduler();

    } catch (err) {
        console.error('[Server] ❌ Error al iniciar:', err.message);
        process.exit(1);
    }
}

start();

require('dotenv').config();

function parseInteger(value, fallback, { min, max } = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    if (typeof min === 'number' && parsed < min) {
        return min;
    }

    if (typeof max === 'number' && parsed > max) {
        return max;
    }

    return parsed;
}

function parseBoolean(value, fallback = false) {
    if (typeof value !== 'string' || value.trim() === '') {
        return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function cleanString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

const env = {
    nodeEnv: cleanString(process.env.NODE_ENV) || 'development',
    port: parseInteger(process.env.PORT, 3000, { min: 1, max: 65535 }),
    timezone: cleanString(process.env.APP_TIMEZONE) || 'America/La_Paz',
    appBaseUrl: cleanString(process.env.APP_BASE_URL) || '',
    requestTimeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 15000, { min: 1000, max: 120000 }),
    deepCrawlDepth: parseInteger(process.env.DEEP_CRAWL_DEPTH, 3, { min: 1, max: 5 }),
    maxConcurrentCrawls: parseInteger(process.env.MAX_CONCURRENT_CRAWLS, 3, { min: 1, max: 10 }),
    crawlIntervalMinutes: parseInteger(process.env.CRAWL_INTERVAL_MINUTES, 60, { min: 5, max: 1440 }),
    schedulerEnabled: parseBoolean(process.env.SCHEDULER_ENABLED, true),
    runPipelineOnStart: parseBoolean(process.env.RUN_PIPELINE_ON_START, true),
    startupPipelineDelayMs: parseInteger(process.env.STARTUP_PIPELINE_DELAY_MS, 30000, { min: 0, max: 600000 }),
    databaseUrl: cleanString(process.env.DATABASE_URL),
    dbPoolMax: parseInteger(process.env.DB_POOL_MAX, 10, { min: 1, max: 50 }),
    dbIdleTimeoutMs: parseInteger(process.env.DB_IDLE_TIMEOUT_MS, 30000, { min: 1000, max: 300000 }),
    dbConnectionTimeoutMs: parseInteger(process.env.DB_CONNECTION_TIMEOUT_MS, 15000, { min: 1000, max: 120000 }),
    apiCacheTtlMs: parseInteger(process.env.API_CACHE_TTL_MS, 60000, { min: 0, max: 3600000 }),
    telegramToken: cleanString(process.env.TELEGRAM_BOT_TOKEN),
    telegramChatId: cleanString(process.env.TELEGRAM_CHAT_ID),
    cerebrasApiKey: cleanString(process.env.CEREBRAS_API_KEY),
    cerebrasModel: cleanString(process.env.CEREBRAS_MODEL) || 'gpt-oss-120b',
    openrouterApiKey: cleanString(process.env.OPENROUTER_API_KEY),
    renderApiKey: cleanString(process.env.RENDER_API_KEY),
    renderServiceId: cleanString(process.env.RENDER_SERVICE_ID),
    githubToken: cleanString(process.env.GITHUB_TOKEN),
    githubOwner: cleanString(process.env.GITHUB_OWNER),
    githubRepo: cleanString(process.env.GITHUB_REPO),
    githubBranch: cleanString(process.env.GITHUB_BRANCH) || 'main',
    neonApiKey: cleanString(process.env.NEON_API_KEY),
};

env.isProduction = env.nodeEnv === 'production';
env.telegramEnabled = Boolean(env.telegramToken && env.telegramChatId);
env.aiEnabled = Boolean(env.cerebrasApiKey);
env.databaseEnabled = Boolean(env.databaseUrl);

Object.freeze(env);

function listMissingEnv(keys) {
    return keys.filter((key) => !cleanString(process.env[key]));
}

module.exports = {
    env,
    listMissingEnv,
    parseBoolean,
    parseInteger,
};

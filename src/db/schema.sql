-- ============================================
-- Sistema Autónomo de Descubrimiento de Recursos Gratuitos
-- Esquema de Base de Datos
-- ============================================

-- Tipos enumerados (idempotente)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_type') THEN
        CREATE TYPE resource_type AS ENUM ('api', 'database', 'vps', 'compute', 'storage', 'tool', 'other');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_status') THEN
        CREATE TYPE resource_status AS ENUM ('active', 'degraded', 'dead', 'unknown');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'resource_domain') THEN
        CREATE TYPE resource_domain AS ENUM ('ml', 'vision', 'nlp', 'compute', 'data', 'devops', 'security', 'general');
    END IF;
END $$;

-- Tabla principal de recursos descubiertos
CREATE TABLE IF NOT EXISTS resources (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    url             TEXT NOT NULL UNIQUE,
    type            resource_type DEFAULT 'other',
    domain          resource_domain DEFAULT 'general',
    status          resource_status DEFAULT 'unknown',
    
    -- Descripción y análisis
    description     TEXT,
    tech_summary    TEXT,
    free_tier       TEXT,
    limitations     TEXT,
    auth_required   BOOLEAN DEFAULT false,
    credit_card     BOOLEAN DEFAULT false,
    
    -- Métricas de scoring y performance
    rarity_score    DECIMAL(5,2) DEFAULT 0,
    value_score     DECIMAL(5,2) DEFAULT 0,
    risk_score      DECIMAL(5,2) DEFAULT 0,
    final_score     DECIMAL(5,2) DEFAULT 0,
    latency_ms      INTEGER,
    
    -- Metadatos de descubrimiento
    source_url      TEXT,
    source_type     VARCHAR(100),
    language        VARCHAR(10) DEFAULT 'en',
    
    -- Timestamps
    discovered_at   TIMESTAMP DEFAULT NOW(),
    last_checked    TIMESTAMP DEFAULT NOW(),
    last_changed    TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    
    -- Tracking de notificaciones
    telegram_notified_at  TIMESTAMP,
    last_ai_analysis      TIMESTAMP,
    notification_hash     TEXT
);

-- Historial de cambios en recursos
CREATE TABLE IF NOT EXISTS resource_history (
    id              SERIAL PRIMARY KEY,
    resource_id     INTEGER REFERENCES resources(id) ON DELETE CASCADE,
    field_changed   VARCHAR(100) NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    changed_at      TIMESTAMP DEFAULT NOW()
);

-- Fuentes de donde se extrae información
CREATE TABLE IF NOT EXISTS crawl_sources (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    url             TEXT NOT NULL UNIQUE,
    source_type     VARCHAR(100),
    is_active       BOOLEAN DEFAULT true,
    last_crawled    TIMESTAMP,
    crawl_frequency VARCHAR(50) DEFAULT 'daily',
    success_rate    DECIMAL(5,2) DEFAULT 100,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Log de operaciones del sistema
CREATE TABLE IF NOT EXISTS system_log (
    id              SERIAL PRIMARY KEY,
    module          VARCHAR(100) NOT NULL,
    action          VARCHAR(255) NOT NULL,
    status          VARCHAR(50) DEFAULT 'info',
    message         TEXT,
    metadata        JSONB,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Alertas generadas por el sistema
CREATE TABLE IF NOT EXISTS alerts (
    id              SERIAL PRIMARY KEY,
    resource_id     INTEGER REFERENCES resources(id) ON DELETE SET NULL,
    alert_type      VARCHAR(100) NOT NULL,
    title           VARCHAR(255) NOT NULL,
    message         TEXT,
    is_read         BOOLEAN DEFAULT false,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Índices para rendimiento
CREATE INDEX IF NOT EXISTS idx_resources_score ON resources(final_score DESC);
CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status);
CREATE INDEX IF NOT EXISTS idx_resources_discovered ON resources(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_resource ON resource_history(resource_id);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_system_log_module ON system_log(module, created_at DESC);

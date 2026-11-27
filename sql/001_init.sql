-- Phase 1 Schema for Correios Florianopolis Route & Financial Management
-- Target: NeonDB PostgreSQL with PostGIS extension

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Global default settings (snapshotted into each route on creation)
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  depot_name TEXT NOT NULL DEFAULT 'CEE Correios - Av. Diomicio de Freitas, 1899',
  depot_cep CHAR(8) NOT NULL DEFAULT '88047401',
  depot_lat DOUBLE PRECISION NOT NULL DEFAULT -27.664631239987585,
  depot_lng DOUBLE PRECISION NOT NULL DEFAULT -48.53156334735702,
  walk_radius_meters INTEGER NOT NULL DEFAULT 150 CHECK (walk_radius_meters BETWEEN 20 AND 1000),
  km_per_liter NUMERIC(6, 2) NOT NULL DEFAULT 10.00 CHECK (km_per_liter > 0),
  rate_per_package_brl NUMERIC(8, 2) NOT NULL DEFAULT 2.11 CHECK (rate_per_package_brl >= 0),
  fuel_price_brl NUMERIC(8, 2) NOT NULL DEFAULT 6.00 CHECK (fuel_price_brl >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. Permanent ViaCEP / BrasilAPI cache restricted strictly to Florianopolis Island CEPs
CREATE TABLE IF NOT EXISTS cep_cache (
  cep CHAR(8) PRIMARY KEY CHECK (
    cep ~ '^[0-9]{8}$'
    AND cep::INTEGER BETWEEN 88010000 AND 88059999
  ),
  logradouro TEXT NOT NULL,
  bairro TEXT,
  localidade TEXT NOT NULL DEFAULT 'Florianopolis',
  uf CHAR(2) NOT NULL DEFAULT 'SC',
  source TEXT NOT NULL CHECK (source IN ('viacep', 'brasilapi')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Address geocoding cache keyed by (cep, numero_norm) with 30-day TTL for Google compliance
-- Note: expires_at is NULL when coordinates were explicitly propagated from a manual pin override.
CREATE TABLE IF NOT EXISTS address_cache (
  cep CHAR(8) NOT NULL CHECK (
    cep ~ '^[0-9]{8}$'
    AND cep::INTEGER BETWEEN 88010000 AND 88059999
  ),
  numero_norm TEXT NOT NULL, -- 'SN' when street number is missing/null
  logradouro TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  geom GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::GEOGRAPHY
  ) STORED,
  place_id TEXT,
  location_type TEXT,
  is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  PRIMARY KEY (cep, numero_norm)
);

CREATE INDEX IF NOT EXISTS idx_address_cache_geom ON address_cache USING GIST (geom);

-- 4. Daily routes (unlimited routes per day)
CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_date DATE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento', 'completa')),
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  depot_lat DOUBLE PRECISION NOT NULL,
  depot_lng DOUBLE PRECISION NOT NULL,
  walk_radius_meters INTEGER NOT NULL DEFAULT 150,
  km_per_liter NUMERIC(6, 2) NOT NULL DEFAULT 10.00,
  rate_per_package_brl NUMERIC(8, 2) NOT NULL DEFAULT 2.11,
  fuel_price_brl NUMERIC(8, 2) NOT NULL DEFAULT 6.00,
  cee_arrival_at TIMESTAMPTZ,
  departed_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  predicted_km NUMERIC(8, 2),
  actual_km NUMERIC(8, 2),
  predicted_duration_sec INTEGER,
  polyline_encoded TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routes_date_status ON routes (route_date, status);

-- 5. Computed route stops (anchors and adjacent walking stops)
CREATE TABLE IF NOT EXISTS route_stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_type TEXT NOT NULL CHECK (stop_type IN ('anchor', 'adjacent')),
  parent_anchor_id UUID REFERENCES route_stops(id) ON DELETE SET NULL,
  sequence_order INTEGER NOT NULL,
  walk_distance_meters INTEGER,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_route_stops_route_seq ON route_stops (route_id, sequence_order);

-- 6. Route packages (unified representation of Lists 1, 2, 3, and 4)
CREATE TABLE IF NOT EXISTS route_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id UUID REFERENCES route_stops(id) ON DELETE SET NULL,
  tracking_code TEXT NOT NULL,
  cep CHAR(8) NOT NULL CHECK (
    cep ~ '^[0-9]{8}$'
    AND cep::INTEGER BETWEEN 88010000 AND 88059999
  ),
  numero_raw TEXT,
  numero_norm TEXT NOT NULL DEFAULT 'SN',
  logradouro TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  is_manual_pin BOOLEAN NOT NULL DEFAULT FALSE,
  is_ar BOOLEAN NOT NULL DEFAULT FALSE,
  is_delivered BOOLEAN NOT NULL DEFAULT FALSE,
  -- List 1 = is_active TRUE; List 4 (Deactivated) = is_active FALSE
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- List 2 (Absent copy) and List 3 (Insufficient address copy)
  in_absent_list BOOLEAN NOT NULL DEFAULT FALSE,
  in_insufficient_list BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (route_id, tracking_code)
);

CREATE INDEX IF NOT EXISTS idx_route_packages_route_active ON route_packages (route_id, is_active);

-- 7. Timestamped operational occurrence logs per route
CREATE TABLE IF NOT EXISTS route_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_route_logs_route ON route_logs (route_id, occurred_at DESC);

-- 8. Asynchronous route calculation job progress tracker (Inngest / staged execution)
CREATE TABLE IF NOT EXISTS route_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  inngest_run_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')
  ),
  stage TEXT NOT NULL DEFAULT 'queued',
  processed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_route_jobs_route_started ON route_jobs (route_id, started_at DESC);

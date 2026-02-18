-- Enable UUID generation (choose one; pgcrypto is simplest)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- Enums (limited options)
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE parking_classification AS ENUM ('QUICK_TURN', 'DEPARTURE', 'STORAGE', 'NONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ops_status AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- Ramp (Ramp level table)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ramps (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  iata                       text NOT NULL,
  base_id                    text NOT NULL,

  -- Type (e.g., "1200.aero" or "manual")
  source_type                text NOT NULL,

  ramp_name                  text NOT NULL,
  square_footage             integer,

  -- Long / flexible lat-lon (point or polygon etc.)
  lat_lon                    jsonb,

  total_units_incl_reserved  integer,
  reserved_units             integer,

  max_weight_mtow_lbs        integer,
  min_wingspan_ft            integer,
  max_wingspan_ft            integer,
  max_height_ft              integer,
  min_length_ft              integer,
  max_length_ft              integer,

  report_parking_use         boolean NOT NULL DEFAULT false,
  remote_parking_reason      text,

  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicates for same base + ramp
  CONSTRAINT uq_ramps_base_ramp UNIQUE (iata, base_id, ramp_name),

  -- Basic sanity checks (optional but recommended)
  CONSTRAINT ck_ramps_units CHECK (
    total_units_incl_reserved IS NULL OR reserved_units IS NULL
    OR total_units_incl_reserved >= reserved_units
  )
);

-- ------------------------------------------------------------
-- Zone (Zone level table) : belongs to Ramp
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zones (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ramp_id                    uuid NOT NULL REFERENCES ramps(id) ON DELETE CASCADE,

  -- denormalized keys for easier filtering (optional, but useful)
  iata                       text NOT NULL,
  base_id                    text NOT NULL,
  ramp_name                  text NOT NULL,

  zone_name                  text NOT NULL,
  square_footage             integer,

  -- utilization rate as percent (0..100)
  utilization_rate_pct       numeric(5,2),

  lat_lon                    jsonb,

  total_units_incl_reserved  integer,
  reserved_units             integer,

  max_weight_mtow_lbs        integer,
  min_wingspan_ft            integer,
  max_wingspan_ft            integer,
  max_height_ft              integer,
  min_length_ft              integer,
  max_length_ft              integer,

  report_parking_use         boolean NOT NULL DEFAULT false,
  remote_parking_reason      text,

  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicate zone names within same ramp
  CONSTRAINT uq_zones_ramp_zone UNIQUE (ramp_id, zone_name),

  CONSTRAINT ck_zones_util CHECK (
    utilization_rate_pct IS NULL OR (utilization_rate_pct >= 0 AND utilization_rate_pct <= 100)
  ),
  CONSTRAINT ck_zones_units CHECK (
    total_units_incl_reserved IS NULL OR reserved_units IS NULL
    OR total_units_incl_reserved >= reserved_units
  )
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_zones_ramp_id ON zones(ramp_id);

-- ------------------------------------------------------------
-- Parking Spots (Parking spot level) : belongs to Zone
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parking_spots (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id                 uuid NOT NULL REFERENCES zones(id) ON DELETE CASCADE,

  -- denormalized keys for easier filtering (optional)
  iata                    text NOT NULL,
  base_id                 text NOT NULL,
  ramp_name               text NOT NULL,
  zone_name               text NOT NULL,

  parking_spot_name       text NOT NULL,

  classification          parking_classification NOT NULL DEFAULT 'NONE',

  max_weight_mtow_lbs     integer,
  min_wingspan_ft         integer,
  max_wingspan_ft         integer,
  max_height_ft           integer,
  min_length_ft           integer,
  max_length_ft           integer,

  ops_status              ops_status NOT NULL DEFAULT 'ACTIVE',
  inactive_status_reason  text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Prevent duplicates within a zone
  CONSTRAINT uq_spots_zone_spot UNIQUE (zone_id, parking_spot_name),

  -- inactive reason required when status inactive
  CONSTRAINT ck_spots_inactive_reason CHECK (
    (ops_status = 'ACTIVE' AND inactive_status_reason IS NULL)
    OR
    (ops_status = 'INACTIVE' AND inactive_status_reason IS NOT NULL AND length(trim(inactive_status_reason)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_spots_zone_id ON parking_spots(zone_id);

-- ------------------------------------------------------------
-- (Optional) Auto-updated updated_at trigger helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ramps_updated_at ON ramps;
CREATE TRIGGER trg_ramps_updated_at
BEFORE UPDATE ON ramps
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_zones_updated_at ON zones;
CREATE TRIGGER trg_zones_updated_at
BEFORE UPDATE ON zones
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_spots_updated_at ON parking_spots;
CREATE TRIGGER trg_spots_updated_at
BEFORE UPDATE ON parking_spots
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

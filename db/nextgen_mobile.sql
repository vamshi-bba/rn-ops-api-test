-- =============================================================================
-- 0) Extensions, helpers
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- for gen_random_uuid()

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- =============================================================================
-- 1) Reservation master
-- =============================================================================
DROP TABLE IF EXISTS public.reservations CASCADE;
CREATE TABLE public.reservations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id                 TEXT,                     -- API: baseid
  external_reservation_id TEXT UNIQUE,              -- optional upstream ID
  reservation_no          TEXT UNIQUE,              -- API: reservationid (e.g. RES-16416)
  reservation_name        TEXT NOT NULL,            -- API: companyName
  customer_account_number TEXT,                     -- API: customerAccountNumber
  tail_number             TEXT NOT NULL,            -- API: tailNumber
  status                  INTEGER,                  -- API: reservationStatus (store raw int)
  reservation_type        TEXT DEFAULT 'both',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  est_arrival_at          TIMESTAMPTZ,
  act_arrival_at          TIMESTAMPTZ,
  est_departure_at        TIMESTAMPTZ,
  act_departure_at        TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_reservations_updated ON public.reservations;
CREATE TRIGGER trg_reservations_updated
BEFORE UPDATE ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- 2) Reservation services (full payload)
-- =============================================================================
DROP TABLE IF EXISTS public.reservation_services CASCADE;
CREATE TABLE public.reservation_services (
  id                        BIGSERIAL PRIMARY KEY,
  reservation_id            UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  product_id                TEXT,          -- productID
  product_name              TEXT NOT NULL, -- productName
  product_status            TEXT,          -- productStatus
  quantity                  INTEGER NOT NULL DEFAULT 1,
  service_date              TIMESTAMPTZ,   -- serviceDateUTC
  subcase_id                TEXT,
  for_arrival_or_departure  TEXT,
  dsf_product_name          TEXT,
  service_request_details   TEXT,
  vendor_name               TEXT,
  on_arrival                BOOLEAN,
  on_departure              BOOLEAN,
  phone_number              TEXT,
  email_address             TEXT,
  quoted_price              NUMERIC(12,4),
  special_instruction_value TEXT,
  vendor_rep                TEXT,
  crew_meal_count           INTEGER,
  pax_meal_count            INTEGER,
  crew_or_passenger         TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resv_services_reservation 
ON public.reservation_services (reservation_id);

-- =============================================================================
-- 3) Consents
-- =============================================================================
DROP TABLE IF EXISTS public.consents CASCADE;
CREATE TABLE public.consents (
  id                    SERIAL PRIMARY KEY,
  reservation_id        UUID NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  full_name             TEXT NOT NULL,
  terms_and_conditions  TEXT NOT NULL,
  terms_version         VARCHAR(50) NOT NULL,
  geo_location          TEXT,
  signature_image       BYTEA NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel               TEXT,
  UNIQUE (reservation_id)
);

-- =============================================================================
-- 4) Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_resv_tail       ON public.reservations (tail_number);
CREATE INDEX IF NOT EXISTS idx_resv_status     ON public.reservations (status);
CREATE INDEX IF NOT EXISTS idx_resv_created_at ON public.reservations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consents_resv   ON public.consents (reservation_id);


-- =============================================================================
-- 5) Base Mapping Table
-- =============================================================================
DROP TABLE IF EXISTS public.base_mapping CASCADE;

CREATE TABLE public.base_mapping (
  base_id            TEXT PRIMARY KEY,     -- Unique (ex: ABZ, ATH, B07, etc.)
  company_code       TEXT NOT NULL,        -- SFS, SFS-EMEA
  base_number        TEXT,                 -- e.g. 7, 9, 10
  iata               TEXT,                 -- e.g. EWR
  icao               TEXT,                 -- e.g. KEWR
  region             TEXT,                 -- NE, MW, EMEA, etc.
  business_division  TEXT,                 -- US, EMEA
  base_description   TEXT,                 -- Aberdeen Airport, Seattle, etc.
  fbo_name           TEXT,                 -- Signature Aviation Aberdeen
  city               TEXT,
  state              TEXT,
  active             BOOLEAN DEFAULT true, -- Y/N mapped as true/false
  currency_code      TEXT,                 -- USD, GBP
  default_units      TEXT,                 -- GAL, L
  base_country       TEXT,                 -- United States, UK, Greece
  base_time_zone     TEXT                  -- e.g. America/New_York, UTC
);

-- Indexes for faster lookup if needed
CREATE INDEX IF NOT EXISTS idx_base_mapping_region
  ON public.base_mapping (region);

CREATE INDEX IF NOT EXISTS idx_base_mapping_country
  ON public.base_mapping (base_country);

ALTER TABLE public.reservations
ADD COLUMN IF NOT EXISTS fbo_name        TEXT,         -- Name of the FBO (e.g., Signature Aviation EWR)
ADD COLUMN IF NOT EXISTS res_created_date TIMESTAMPTZ,  -- Original creation datetime from external source
ADD COLUMN IF NOT EXISTS flight_name     TEXT,         -- Aircraft name (e.g., G650, Falcon 900)
ADD COLUMN IF NOT EXISTS flight_model    TEXT,         -- Aircraft model / manufacturer
ADD COLUMN IF NOT EXISTS flight_type     TEXT; 

ALTER TABLE reservations ALTER COLUMN status TYPE TEXT;

-- =============================================================================
-- 6) Base Email Preferences
-- =============================================================================
DROP TABLE IF EXISTS public.base_email_preferences CASCADE;

CREATE TABLE public.base_email_preferences (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT NOT NULL UNIQUE,               -- e.g. user@signatureaviation.com
  base_preference  TEXT,                               -- Comma-separated base IDs (e.g. 'ABZ,B07,EWR')
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update timestamp
DROP TRIGGER IF EXISTS trg_base_email_pref_updated ON public.base_email_preferences;
CREATE TRIGGER trg_base_email_pref_updated
BEFORE UPDATE ON public.base_email_preferences
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Optional index if you will query by email frequently
CREATE INDEX IF NOT EXISTS idx_base_email_pref_email
  ON public.base_email_preferences (email);






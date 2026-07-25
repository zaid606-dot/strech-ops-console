-- 001_spine.sql — Stage 2 dispatch spine

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE service_request_status AS ENUM (
    'dispatching',
    'booked',
    'confirmed',
    'checked_in',
    'completed',
    'needs_review',
    'reviewed',
    'closed',
    'no_show',
    'cancelled',
    'disputed',
    'resolved'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE actor_role AS ENUM ('member', 'ops', 'contractor', 'system', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_owner AS ENUM ('agent', 'ops');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vetting_status AS ENUM ('pending', 'approved', 'suspended', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS homeowners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  membership_tier TEXT NOT NULL DEFAULT 'Free'
    CHECK (membership_tier IN ('Free', 'Comfort', 'Premium')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homeowner_id UUID NOT NULL REFERENCES homeowners(id),
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  rating NUMERIC(3,2),
  categories TEXT[] NOT NULL DEFAULT '{}',
  service_zips TEXT[] NOT NULL DEFAULT '{}',
  vetting_status vetting_status NOT NULL DEFAULT 'pending',
  vetted_at TIMESTAMPTZ,
  insurance_expires_at TIMESTAMPTZ,
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS availability_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  slot_start TIMESTAMPTZ NOT NULL,
  slot_end TIMESTAMPTZ NOT NULL,
  CHECK (slot_end > slot_start)
);

CREATE INDEX IF NOT EXISTS availability_slots_contractor_idx
  ON availability_slots (contractor_id, slot_start);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  slot_start TIMESTAMPTZ NOT NULL,
  slot_end TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slot_end > slot_start)
);

-- Prevent overlapping appointments per contractor (Stage 2 / H10)
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    contractor_id WITH =,
    tstzrange(slot_start, slot_end, '[)') WITH &&
  );

CREATE TABLE IF NOT EXISTS service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  homeowner_id UUID NOT NULL REFERENCES homeowners(id),
  property_id UUID NOT NULL REFERENCES properties(id),
  category_id TEXT NOT NULL,
  status service_request_status NOT NULL DEFAULT 'dispatching',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  preferred_window_start TIMESTAMPTZ,
  preferred_window_end TIMESTAMPTZ,
  assigned_contractor_id UUID REFERENCES contractors(id),
  appointment_id UUID REFERENCES appointments(id),
  promise_by TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  confirmation_code TEXT UNIQUE,
  parent_request_id UUID REFERENCES service_requests(id),
  dispatch_owner dispatch_owner NOT NULL DEFAULT 'agent',
  arrival_acked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS service_requests_status_idx ON service_requests (status);
CREATE INDEX IF NOT EXISTS service_requests_pool_idx
  ON service_requests (created_at)
  WHERE status = 'dispatching';

CREATE TABLE IF NOT EXISTS job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  from_status service_request_status,
  to_status service_request_status NOT NULL,
  actor_role actor_role NOT NULL,
  actor_id UUID NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_events_request_idx
  ON job_events (service_request_id, created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

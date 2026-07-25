-- 003_confirm.sql — Stage 5: charges + reminder_jobs (money ≠ status)

DO $$ BEGIN
  CREATE TYPE charge_status AS ENUM (
    'pending',
    'captured',
    'failed',
    'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reminder_kind AS ENUM (
    't_24h',
    't_2h',
    't_30m'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE reminder_status AS ENUM (
    'scheduled',
    'fired',
    'cancelled',
    'skipped'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  status charge_status NOT NULL DEFAULT 'pending',
  membership_tier TEXT NOT NULL,
  category_id TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active (non-voided) charge per request in v1
CREATE UNIQUE INDEX IF NOT EXISTS charges_one_active_per_request
  ON charges (service_request_id)
  WHERE status IN ('pending', 'captured', 'failed');

CREATE INDEX IF NOT EXISTS charges_request_idx ON charges (service_request_id);

CREATE TABLE IF NOT EXISTS reminder_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  kind reminder_kind NOT NULL,
  fire_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  status reminder_status NOT NULL DEFAULT 'scheduled',
  fired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminder_jobs_due_idx
  ON reminder_jobs (fire_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS reminder_jobs_request_idx
  ON reminder_jobs (service_request_id, fire_at);

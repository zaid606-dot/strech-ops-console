-- 002_offers.sql — Stage 4 offer waves + cases stub

DO $$ BEGIN
  CREATE TYPE offer_status AS ENUM (
    'pending', 'accepted', 'declined', 'expired', 'withdrawn', 'channel_failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE wave_strategy AS ENUM ('sequential', 'parallel_batch');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE case_type AS ENUM (
    'escalation', 'scope_change', 'reschedule', 'no_show',
    'parts_hold', 'dispute', 'emergency', 'cancel_request'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE case_status AS ENUM ('open', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS dispatch_waves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  strategy wave_strategy NOT NULL,
  batch_size INT NOT NULL DEFAULT 1,
  wave_number INT NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS dispatch_waves_request_idx
  ON dispatch_waves (service_request_id, started_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wave_id UUID NOT NULL REFERENCES dispatch_waves(id),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  rank INT NOT NULL,
  status offer_status NOT NULL DEFAULT 'pending',
  slot_start TIMESTAMPTZ NOT NULL,
  slot_end TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  reply_token TEXT NOT NULL UNIQUE,
  score NUMERIC(8,4),
  channel TEXT NOT NULL DEFAULT 'console',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_offers_one_accepted
  ON dispatch_offers (service_request_id)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS dispatch_offers_pending_idx
  ON dispatch_offers (expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS dispatch_offers_request_idx
  ON dispatch_offers (service_request_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  type case_type NOT NULL,
  status case_status NOT NULL DEFAULT 'open',
  reason_code TEXT,
  owner_role actor_role NOT NULL DEFAULT 'ops',
  blocks_close BOOLEAN NOT NULL DEFAULT false,
  money_impact TEXT NOT NULL DEFAULT 'none',
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cases_open_idx
  ON cases (status, type)
  WHERE status = 'open';

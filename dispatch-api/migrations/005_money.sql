-- 005_money.sql — Stage 9: payouts, payment_attempts, refunds (money ≠ status)

DO $$ BEGIN
  CREATE TYPE payout_status AS ENUM ('held', 'payable', 'paid', 'clawed_back', 'waived');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_attempt_status AS ENUM ('pending', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE refund_status AS ENUM ('pending', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  contractor_id UUID NOT NULL REFERENCES contractors(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status payout_status NOT NULL DEFAULT 'held',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payouts_one_per_request
  ON payouts (service_request_id);

CREATE INDEX IF NOT EXISTS payouts_contractor_idx ON payouts (contractor_id, status);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id UUID NOT NULL REFERENCES charges(id),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status payment_attempt_status NOT NULL DEFAULT 'pending',
  provider_ref TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_attempts_charge_idx
  ON payment_attempts (charge_id, created_at DESC);

CREATE TABLE IF NOT EXISTS refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id UUID NOT NULL REFERENCES charges(id),
  service_request_id UUID NOT NULL REFERENCES service_requests(id),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status refund_status NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refunds_request_idx ON refunds (service_request_id);

-- Optional review metadata on request
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS review_rating SMALLINT,
  ADD COLUMN IF NOT EXISTS review_comment TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_acked_at TIMESTAMPTZ;

-- 006_idempotency.sql — Stage 10 write idempotency store

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_sub UUID NOT NULL,
  actor_role TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status_code INT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actor_sub, idem_key)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx
  ON idempotency_keys (created_at);

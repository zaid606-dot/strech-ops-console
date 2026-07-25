-- 004_agent.sql — Stage 6 agent policy + tick log

CREATE TABLE IF NOT EXISTS agent_policy (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version INT NOT NULL DEFAULT 1,
  settings JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

INSERT INTO agent_policy (id, version, settings)
VALUES (
  1,
  1,
  '{
    "offer": {
      "strategy": "parallel_batch",
      "batch_size": 3,
      "ttl_seconds": 600,
      "max_waves_before_ops": 3
    },
    "confirm": {
      "auto_confirm_visit": true,
      "require_contractor_ack": true,
      "max_eta_slip_minutes": 30,
      "reminder_cadence": ["24h", "2h", "30m"]
    },
    "field": {
      "auto_apply_sms": true,
      "ambiguous_sms": "escalate"
    },
    "sla": {
      "promise_by_escalate_minutes": 30
    },
    "stuck": {
      "no_progress_minutes": 45
    }
  }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS agent_tick_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by_role actor_role NOT NULL,
  triggered_by_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  items_seen INT NOT NULL DEFAULT 0,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT
);

CREATE INDEX IF NOT EXISTS agent_tick_log_started_idx
  ON agent_tick_log (started_at DESC);

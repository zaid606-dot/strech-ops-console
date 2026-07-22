'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Policy = {
  version: number;
  settings: {
    offer: {
      strategy: string;
      batch_size: number;
      ttl_seconds: number;
      max_waves_before_ops: number;
    };
    confirm: {
      auto_confirm_visit: boolean;
      require_contractor_ack: boolean;
      max_eta_slip_minutes: number;
    };
    sla: { promise_by_escalate_minutes: number };
    stuck: { no_progress_minutes: number };
  };
};

type WorkItem = {
  service_request_id: string;
  status: string;
  confirmation_code: string | null;
  reason: string;
  priority: number;
};

type TickLog = {
  id: string;
  started_at: string;
  finished_at: string | null;
  items_seen: number;
  actions: { service_request_id: string; action: string; reason: string; ok: boolean }[];
};

type Escalation = {
  id: string;
  service_request_id: string;
  reason_code: string | null;
  confirmation_code: string | null;
  request_status: string;
  created_at: string;
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AgentPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [work, setWork] = useState<WorkItem[]>([]);
  const [ticks, setTicks] = useState<TickLog[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, w, t, e] = await Promise.all([
        fetch('/api/ops/agent/policy'),
        fetch('/api/ops/agent/work'),
        fetch('/api/ops/agent/ticks'),
        fetch('/api/ops/agent/escalations'),
      ]);
      const pb = await p.json();
      const wb = await w.json();
      const tb = await t.json();
      const eb = await e.json();
      if (!p.ok) {
        setError(pb.detail ?? pb.error ?? 'policy failed');
        return;
      }
      setPolicy(pb);
      if (w.ok) setWork(wb.items ?? []);
      if (t.ok) setTicks(tb.items ?? []);
      if (e.ok) setEscalations(eb.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agent');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function patchPolicy(patch: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/ops/agent/policy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Policy update failed');
        return;
      }
      setPolicy(body);
      setMsg(`Policy v${body.version} saved`);
    } finally {
      setBusy(false);
    }
  }

  async function runTick() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/ops/agent/tick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 25 }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Tick failed');
        return;
      }
      setMsg(
        `Tick: ${body.items_seen} seen · ${(body.actions as unknown[]).length} actions`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  const s = policy?.settings;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Agent</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Work queue · policy · tick worker. Mutations always log as{' '}
            <span className="mono">actor_role=agent</span>.
          </p>
        </div>
        <button className="primary" type="button" disabled={busy} onClick={() => void runTick()}>
          {busy ? 'Working…' : 'Run tick now'}
        </button>
      </div>

      {error ? <p className="err">{error}</p> : null}
      {msg ? <p className="ok">{msg}</p> : null}

      <section
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 14,
          background: 'var(--bg-elevated)',
          display: 'grid',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>
            Policy {policy ? <span className="mono muted">v{policy.version}</span> : null}
          </h2>
        </div>
        {!s ? (
          <p className="muted">Loading…</p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">auto_confirm_visit</span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void patchPolicy({
                    confirm: { auto_confirm_visit: !s.confirm.auto_confirm_visit },
                  })
                }
              >
                {s.confirm.auto_confirm_visit ? 'ON' : 'OFF'}
              </button>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">offer.strategy</span>
              <select
                value={s.offer.strategy}
                disabled={busy}
                onChange={(e) =>
                  void patchPolicy({ offer: { strategy: e.target.value } })
                }
              >
                <option value="sequential">sequential</option>
                <option value="parallel_batch">parallel_batch</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">offer.ttl_seconds</span>
              <input
                type="number"
                defaultValue={s.offer.ttl_seconds}
                disabled={busy}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v === s.offer.ttl_seconds) return;
                  void patchPolicy({ offer: { ttl_seconds: v } });
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">offer.batch_size</span>
              <input
                type="number"
                defaultValue={s.offer.batch_size}
                disabled={busy}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v === s.offer.batch_size) return;
                  void patchPolicy({ offer: { batch_size: v } });
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">stuck.no_progress_minutes</span>
              <input
                type="number"
                defaultValue={s.stuck.no_progress_minutes}
                disabled={busy}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v === s.stuck.no_progress_minutes) return;
                  void patchPolicy({ stuck: { no_progress_minutes: v } });
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">sla.promise_by_escalate_minutes</span>
              <input
                type="number"
                defaultValue={s.sla.promise_by_escalate_minutes}
                disabled={busy}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v === s.sla.promise_by_escalate_minutes) return;
                  void patchPolicy({ sla: { promise_by_escalate_minutes: v } });
                }}
              />
            </label>
          </div>
        )}
      </section>

      <section
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14 }}>Work queue ({work.length})</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Status</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {work.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  Queue empty
                </td>
              </tr>
            ) : null}
            {work.map((w) => (
              <tr key={`${w.service_request_id}-${w.reason}`}>
                <td className="mono">{w.confirmation_code ?? w.service_request_id.slice(0, 8)}</td>
                <td>
                  <span className={`pill ${w.status}`}>{w.status}</span>
                </td>
                <td className="mono">{w.reason}</td>
                <td>
                  <Link href={`/ops/requests/${w.service_request_id}`}>Desk →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14 }}>Escalations ({escalations.length})</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Code</th>
              <th>Reason</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {escalations.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No open escalations
                </td>
              </tr>
            ) : null}
            {escalations.map((e) => (
              <tr key={e.id}>
                <td className="mono muted">{fmt(e.created_at)}</td>
                <td>
                  <Link href={`/ops/requests/${e.service_request_id}`}>
                    {e.confirmation_code ?? e.service_request_id.slice(0, 8)}
                  </Link>
                </td>
                <td className="mono">{e.reason_code ?? '—'}</td>
                <td>
                  <span className={`pill ${e.request_status}`}>{e.request_status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14 }}>Tick log</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Seen</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ticks.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  No ticks yet — press Run tick now
                </td>
              </tr>
            ) : null}
            {ticks.map((t) => (
              <tr key={t.id}>
                <td className="mono muted">{fmt(t.started_at)}</td>
                <td>{t.items_seen}</td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {(Array.isArray(t.actions) ? t.actions : [])
                    .slice(0, 6)
                    .map((a) => `${a.action}:${a.reason}`)
                    .join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

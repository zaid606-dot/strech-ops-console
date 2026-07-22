'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type CaseRow = {
  id: string;
  service_request_id: string;
  type: string;
  status: string;
  reason_code: string | null;
  blocks_close: boolean;
  money_impact: string;
  confirmation_code: string | null;
  request_status: string;
  created_at: string;
  meta?: Record<string, unknown>;
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function CasesPage() {
  const [items, setItems] = useState<CaseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState('open');
  const [scopeAmount, setScopeAmount] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/ops/cases?status=${filter}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        return;
      }
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cases');
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  async function resolve(id: string, resolution: 'resolved' | 'dismissed') {
    setBusy(id);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/ops/cases/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Resolve failed');
        return;
      }
      setMsg(`Case ${resolution}`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function approveScope(id: string) {
    const cents = Number(scopeAmount[id]);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter amount cents for scope approve');
      return;
    }
    setBusy(`scope-${id}`);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/ops/cases/${id}/approve-scope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_cents: cents }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Approve failed');
        return;
      }
      setMsg(`Scope approved @ ${cents}¢`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
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
          <h1 style={{ margin: 0, fontSize: 22 }}>Cases</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Emergencies first. Ops owns resolve and scope price approve.
          </p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="open">Open</option>
          <option value="all">All</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>

      {error ? <p className="err">{error}</p> : null}
      {msg ? <p className="ok">{msg}</p> : null}

      <section
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Request</th>
              <th>Reason</th>
              <th>Flags</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No cases
                </td>
              </tr>
            ) : null}
            {items.map((c) => (
              <tr key={c.id}>
                <td className="mono muted">{fmt(c.created_at)}</td>
                <td>
                  <span
                    className={`pill ${c.type === 'emergency' ? 'disputed' : c.status}`}
                  >
                    {c.type}
                  </span>
                </td>
                <td>
                  <Link href={`/ops/requests/${c.service_request_id}`}>
                    {c.confirmation_code ?? c.service_request_id.slice(0, 8)}
                  </Link>
                  <div className="mono muted" style={{ fontSize: 11 }}>
                    {c.request_status}
                  </div>
                </td>
                <td className="mono">{c.reason_code ?? '—'}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {c.blocks_close ? 'blocks_close · ' : ''}
                  {c.money_impact !== 'none' ? c.money_impact : '—'}
                </td>
                <td>
                  {c.status === 'open' ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {c.type === 'scope_change' ? (
                        <>
                          <input
                            style={{ width: 90 }}
                            className="mono"
                            placeholder="cents"
                            value={scopeAmount[c.id] ?? ''}
                            onChange={(e) =>
                              setScopeAmount((s) => ({ ...s, [c.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => void approveScope(c.id)}
                          >
                            Approve $
                          </button>
                        </>
                      ) : null}
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void resolve(c.id, 'resolved')}
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void resolve(c.id, 'dismissed')}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : (
                    <span className="muted">{c.status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

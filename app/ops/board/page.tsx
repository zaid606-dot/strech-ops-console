'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { ServiceRequest } from '@/lib/dispatch/types';

const QUEUE_ORDER = [
  'dispatching',
  'booked',
  'confirmed',
  'checked_in',
  'needs_review',
  'no_show',
  'disputed',
] as const;

const STATUS_LABELS: Record<(typeof QUEUE_ORDER)[number], string> = {
  dispatching: 'Dispatching',
  booked: 'Booked',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  needs_review: 'Needs review',
  no_show: 'No show',
  disputed: 'Disputed',
};

function placeLabel(r: ServiceRequest) {
  const parts = [r.city, r.state, r.zip].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

function isPastDue(promiseBy: string | null | undefined) {
  if (!promiseBy) return false;
  const t = new Date(promiseBy).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function fmtPromise(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function BoardPage() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [queues, setQueues] = useState<Record<string, ServiceRequest[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await fetch('/api/ops/board');
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        return;
      }
      setCounts(body.counts ?? {});
      setQueues(body.queues ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load board');
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load({ quiet: true }), 20000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 16,
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Ops board</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Live queues across the desk. Auto-refresh 20s.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        {QUEUE_ORDER.map((status) => {
          const items = queues[status] ?? [];
          const n = counts[status] ?? items.length;
          return (
            <section
              key={status}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 6,
                background: 'var(--bg-elevated)',
                minHeight: 160,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <header
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span className={`pill ${status}`}>{STATUS_LABELS[status]}</span>
                <span className="mono muted">{n}</span>
              </header>
              <ul style={{ listStyle: 'none', margin: 0, padding: 8, flex: 1 }}>
                {items.length === 0 ? (
                  <li className="muted" style={{ padding: 6, fontSize: 12 }}>
                    No jobs in this queue
                  </li>
                ) : null}
                {items.map((r) => {
                  const pastDue = isPastDue(r.promise_by);
                  return (
                    <li key={r.id} style={{ marginBottom: 6 }}>
                      <Link
                        href={`/ops/requests/${r.id}`}
                        style={{
                          display: 'block',
                          padding: '6px 8px',
                          borderRadius: 4,
                          border: pastDue
                            ? '1px solid var(--danger)'
                            : '1px solid var(--border)',
                          background: 'var(--bg)',
                          textDecoration: 'none',
                          color: 'var(--text)',
                        }}
                      >
                        <div className="mono" style={{ fontSize: 12 }}>
                          {r.confirmation_code ?? r.id.slice(0, 8)}
                        </div>
                        <div style={{ fontSize: 13, marginTop: 2 }}>
                          {r.member_name ?? '—'}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {placeLabel(r)} · {r.category_id}
                        </div>
                        {r.assigned_contractor_name ? (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {r.assigned_contractor_name}
                          </div>
                        ) : null}
                        <div
                          className={pastDue ? 'err' : 'muted'}
                          style={{ fontSize: 11, marginTop: 2 }}
                          title={pastDue ? 'Past due' : undefined}
                        >
                          Promise {fmtPromise(r.promise_by)}
                          {pastDue ? ' · past due' : ''}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

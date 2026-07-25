'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { ServiceRequest } from '@/lib/dispatch/types';

function fmt(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function PoolPage() {
  const [items, setItems] = useState<ServiceRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ops/pool');
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        setItems([]);
        return;
      }
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load pool');
    } finally {
      if (!opts?.quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load({ quiet: true }), 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 16,
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Dispatch pool</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Real members in <span className="mono">dispatching</span>, unassigned. Auto-refresh 15s.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href="/ops/book"
            className="primary"
            style={{ display: 'inline-block', padding: '8px 14px' }}
          >
            Book visit
          </Link>
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Member</th>
              <th>Address</th>
              <th>Category</th>
              <th>Preferred window</th>
              <th>Promise by</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="muted">
                  No jobs waiting for a contractor.{' '}
                  <Link href="/ops/book">Add a visit to the dispatch pool</Link>.
                </td>
              </tr>
            ) : null}
            {items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/ops/requests/${r.id}`} className="mono">
                    {r.confirmation_code ?? r.id.slice(0, 8)}
                  </Link>
                </td>
                <td>
                  <div>{r.member_name ?? '—'}</div>
                  <div className="mono muted" style={{ fontSize: 11 }}>
                    {r.member_phone || r.member_email || ''}
                  </div>
                </td>
                <td>
                  <div>{r.address_line1 ?? '—'}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[r.city, r.state, r.zip].filter(Boolean).join(', ')}
                  </div>
                </td>
                <td>{r.category_id}</td>
                <td className="mono muted">
                  {fmt(r.preferred_window_start)}
                  <br />
                  {fmt(r.preferred_window_end)}
                </td>
                <td className="mono muted">{fmt(r.promise_by)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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

  const load = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
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
            Requests in <span className="mono">dispatching</span>, unassigned. Auto-refresh 15s.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Category</th>
              <th>Status</th>
              <th>Preferred window</th>
              <th>Promise by</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="muted">
                  Pool is empty.
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
                <td>{r.category_id}</td>
                <td>
                  <span className={`pill ${r.status}`}>{r.status}</span>
                </td>
                <td className="mono muted">
                  {fmt(r.preferred_window_start)}
                  <br />
                  {fmt(r.preferred_window_end)}
                </td>
                <td className="mono muted">{fmt(r.promise_by)}</td>
                <td className="mono muted">{fmt(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

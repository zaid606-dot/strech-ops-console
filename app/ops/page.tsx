'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Overview = {
  dispatching: number;
  booked: number;
  confirmed: number;
  checked_in: number;
  sla_breach: number;
};

export default function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/ops/overview');
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Overview failed (${res.status})`);
        setData(null);
        return;
      }
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  const tiles = [
    { label: 'Dispatching', href: '/ops/pool', value: data?.dispatching, color: 'var(--warn)' },
    { label: 'Booked', href: '/ops/board', value: data?.booked, color: 'var(--accent)' },
    { label: 'Confirmed', href: '/ops/board', value: data?.confirmed, color: 'var(--ok)' },
    { label: 'SLA breach', href: '/ops/pool', value: data?.sla_breach, color: 'var(--danger)' },
  ];

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Overview</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Live dispatch counts from <span className="mono">/v1</span>. Auto-refresh 8s.
          </p>
        </div>
        <Link href="/ops/book" className="primary" style={{ display: 'inline-block', padding: '8px 14px' }}>
          Book visit
        </Link>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            style={{
              display: 'grid',
              gap: 6,
              padding: 14,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <span className="muted" style={{ fontSize: 12 }}>
              {tile.label}
            </span>
            <span
              style={{
                fontSize: 28,
                fontWeight: 600,
                fontFamily: 'var(--mono)',
                color: tile.color,
              }}
            >
              {tile.value ?? '—'}
            </span>
          </Link>
        ))}
      </div>

      <section
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 14,
          background: 'var(--bg-elevated)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Needs you</h2>
        <p className="muted" style={{ margin: 0 }}>
          {data && data.sla_breach > 0 ? (
            <>
              {data.sla_breach} request(s) past <span className="mono">promise_by</span> — check{' '}
              <Link href="/ops/pool">Pool</Link>.
            </>
          ) : (
            <>
              No SLA breaches.{' '}
              <Link href="/ops/book">Book a real visit</Link> to put a member into the pool.
            </>
          )}
        </p>
      </section>
    </div>
  );
}

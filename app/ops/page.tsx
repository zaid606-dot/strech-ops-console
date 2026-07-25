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
  const [emergencyOpen, setEmergencyOpen] = useState<number | null>(null);
  const [agentQueue, setAgentQueue] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [oRes, cRes, wRes] = await Promise.all([
        fetch('/api/ops/overview'),
        fetch('/api/ops/cases?status=open'),
        fetch('/api/ops/agent/work'),
      ]);
      const body = await oRes.json();
      if (!oRes.ok) {
        setError(body.detail ?? body.error ?? `Overview failed (${oRes.status})`);
        setData(null);
        return;
      }
      setData(body);

      if (cRes.ok) {
        const casesBody = await cRes.json();
        const items = (casesBody.items ?? []) as { type?: string }[];
        setEmergencyOpen(items.filter((c) => c.type === 'emergency').length);
      } else {
        setEmergencyOpen(null);
      }

      if (wRes.ok) {
        const w = await wRes.json();
        setAgentQueue((w.items as unknown[])?.length ?? 0);
      } else {
        setAgentQueue(null);
      }
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
    { label: 'Checked in', href: '/ops/board', value: data?.checked_in, color: 'var(--ok)' },
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
        <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>Needs you</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
          <li>
            {data && data.sla_breach > 0 ? (
              <>
                <strong style={{ color: 'var(--danger)' }}>{data.sla_breach}</strong> SLA
                breach(es) — <Link href="/ops/pool">Pool</Link>
              </>
            ) : (
              <>No SLA breaches</>
            )}
          </li>
          <li>
            {emergencyOpen != null && emergencyOpen > 0 ? (
              <>
                <strong style={{ color: 'var(--danger)' }}>{emergencyOpen}</strong> open
                emergency case(s) — <Link href="/ops/cases">Cases</Link>
              </>
            ) : emergencyOpen === 0 ? (
              <>No open emergency cases</>
            ) : (
              <>Emergency cases unavailable</>
            )}
          </li>
          <li>
            {agentQueue != null && agentQueue > 0 ? (
              <>
                <strong>{agentQueue}</strong> in agent queue —{' '}
                <Link href="/ops/agent">Agent</Link>
              </>
            ) : agentQueue === 0 ? (
              <>Agent queue empty</>
            ) : (
              <>Agent queue unavailable</>
            )}
          </li>
        </ul>
      </section>
    </div>
  );
}

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

export function LiveStrip() {
  const [data, setData] = useState<Overview | null>(null);
  const [queue, setQueue] = useState<number | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const [oRes, wRes] = await Promise.all([
        fetch('/api/ops/overview'),
        fetch('/api/ops/agent/work'),
      ]);
      if (!oRes.ok) {
        setErr(true);
        return;
      }
      setErr(false);
      setData(await oRes.json());
      if (wRes.ok) {
        const w = await wRes.json();
        setQueue((w.items as unknown[])?.length ?? 0);
      }
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  if (err) {
    return (
      <div
        style={{
          padding: '8px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        Counts unavailable
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px 16px',
        padding: '8px 20px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        fontSize: 12,
        color: 'var(--text-muted)',
        alignItems: 'center',
      }}
    >
      <span>
        Dispatching{' '}
        <strong style={{ color: 'var(--warn)' }}>{data?.dispatching ?? '…'}</strong>
      </span>
      <span>
        Booked <strong style={{ color: 'var(--accent)' }}>{data?.booked ?? '…'}</strong>
      </span>
      <span>
        Confirmed <strong style={{ color: 'var(--ok)' }}>{data?.confirmed ?? '…'}</strong>
      </span>
      <Link
        href="/ops/pool"
        style={{
          color: 'inherit',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        SLA{' '}
        <strong style={{ color: 'var(--danger)', fontSize: 14 }}>
          {data?.sla_breach ?? '…'}
        </strong>
      </Link>
      <Link
        href="/ops/agent"
        style={{
          color: 'inherit',
          textDecoration: 'none',
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        Agent{' '}
        <strong style={{ color: 'var(--text)', fontSize: 14 }}>{queue ?? '…'}</strong>
      </Link>
    </div>
  );
}

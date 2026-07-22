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
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/overview');
      if (!res.ok) {
        setErr(true);
        return;
      }
      setErr(false);
      setData(await res.json());
    } catch {
      setErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

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
      }}
    >
      <span>
        Pool{' '}
        <strong style={{ color: 'var(--warn)' }}>
          {err ? '—' : (data?.dispatching ?? '…')}
        </strong>
      </span>
      <span>
        Booked{' '}
        <strong style={{ color: 'var(--accent)' }}>{err ? '—' : (data?.booked ?? '…')}</strong>
      </span>
      <span>
        Confirmed{' '}
        <strong style={{ color: 'var(--ok)' }}>{err ? '—' : (data?.confirmed ?? '…')}</strong>
      </span>
      <span>
        SLA breach{' '}
        <strong style={{ color: 'var(--danger)' }}>
          {err ? '—' : (data?.sla_breach ?? '…')}
        </strong>
      </span>
      <span>
        Agent <span className="mono">stage 6</span>
      </span>
      <span style={{ marginLeft: 'auto' }}>
        <Link href="/ops/pool">Open pool →</Link>
      </span>
    </div>
  );
}

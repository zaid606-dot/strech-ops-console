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
        Agent queue{' '}
        <strong style={{ color: 'var(--text)' }}>{err ? '—' : (queue ?? '…')}</strong>
      </span>
      <span style={{ marginLeft: 'auto' }}>
        <Link href="/ops/agent">Agent →</Link>
      </span>
    </div>
  );
}

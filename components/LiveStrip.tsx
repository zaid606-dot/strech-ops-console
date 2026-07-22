'use client';

import Link from 'next/link';

/** Stage 1 skeleton — wired to live counts in later stages. */
export function LiveStrip() {
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
        Pool <strong style={{ color: 'var(--warn)' }}>—</strong>
      </span>
      <span>
        Offers <strong style={{ color: 'var(--accent)' }}>—</strong>
      </span>
      <span>
        Emergencies <strong style={{ color: 'var(--danger)' }}>0</strong>
      </span>
      <span>
        Agent <span className="mono">offline</span>
      </span>
      <span className="muted">SLA —</span>
      <span style={{ marginLeft: 'auto' }}>
        <Link href="/ops/pool">Open pool →</Link>
      </span>
    </div>
  );
}

import Link from 'next/link';

import { getOpsSession } from '@/lib/auth/ops';

export default async function OverviewPage() {
  const session = await getOpsSession();

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>Overview</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Signed in as <span className="mono">{session?.username}</span>. Stage 1 shell —
          live metrics land in Stage 3+.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        {[
          { label: 'Dispatching', href: '/ops/pool', value: '—' },
          { label: 'Board', href: '/ops/board', value: '—' },
          { label: 'Contractors', href: '/ops/contractors', value: '—' },
          { label: 'Cases', href: '/ops', value: '0', note: 'Stage 8' },
        ].map((tile) => (
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
            <span style={{ fontSize: 28, fontWeight: 600, fontFamily: 'var(--mono)' }}>
              {tile.value}
            </span>
            {tile.note ? (
              <span className="muted" style={{ fontSize: 11 }}>
                {tile.note}
              </span>
            ) : null}
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
          Escalations, SLA breaches, and emergencies will list here after the API stages.
          Until then, use <Link href="/ops/pool">Pool</Link> when dispatch is connected.
        </p>
      </section>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { LiveStrip } from '@/components/LiveStrip';

const NAV: { href: string; label: string; exact?: boolean; soon?: boolean }[] = [
  { href: '/ops', label: 'Overview', exact: true },
  { href: '/ops/pool', label: 'Pool' },
  { href: '/ops/board', label: 'Board' },
  { href: '/ops/offers', label: 'Offers' },
  { href: '/ops/agent', label: 'Agent', soon: true },
  { href: '/ops/cases', label: 'Cases', soon: true },
  { href: '/ops/contractors', label: 'Contractors' },
];

export function OpsShell({
  operatorSub,
  username,
  children,
}: {
  operatorSub: string;
  username: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto auto 1fr' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontWeight: 600, letterSpacing: '0.04em' }}>STRECH OPS</div>
        <nav style={{ display: 'flex', gap: 12, flex: 1, flexWrap: 'wrap' }}>
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            if (item.soon) {
              return (
                <span
                  key={item.href}
                  title="Coming in a later stage"
                  style={{
                    color: 'var(--text-muted)',
                    opacity: 0.55,
                    paddingBottom: 2,
                    borderBottom: '2px solid transparent',
                    cursor: 'default',
                  }}
                >
                  {item.label}
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  fontWeight: active ? 600 : 400,
                  textDecoration: 'none',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  paddingBottom: 2,
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/field/login" className="muted" style={{ fontSize: 12 }}>
          Field →
        </Link>
        <span className="mono muted" title={operatorSub}>
          {username}
        </span>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      <LiveStrip />
      <div style={{ padding: 20, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

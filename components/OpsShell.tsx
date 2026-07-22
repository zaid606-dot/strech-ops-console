'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export function OpsShell({
  operatorSub,
  children,
}: {
  operatorSub: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  const nav = [
    { href: '/ops', label: 'Pool' },
    { href: '/ops/board', label: 'Board' },
    { href: '/ops/change-requests', label: 'Changes' },
    { href: '/ops/applications', label: 'Applications' },
    { href: '/ops/contractors', label: 'Contractors' },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        <div style={{ fontWeight: 600, letterSpacing: '0.04em' }}>STRECH OPS</div>
        <nav style={{ display: 'flex', gap: 12, flex: 1 }}>
          {nav.map((item) => {
            const active =
              item.href === '/ops'
                ? pathname === '/ops'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  fontWeight: active ? 600 : 400,
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <a href="/field/login" className="muted" style={{ fontSize: 12 }}>
          Field →
        </a>
        <span className="mono muted">{operatorSub}</span>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      <div style={{ padding: 20, maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

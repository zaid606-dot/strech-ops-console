'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

export function FieldShell({
  contractorId,
  children,
}: {
  contractorId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  async function logout() {
    await fetch('/api/field/auth/logout', { method: 'POST' });
    router.replace('/field/login');
    router.refresh();
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
        }}
      >
        <div style={{ fontWeight: 600, letterSpacing: '0.04em' }}>STRECH FIELD</div>
        <Link href="/field" style={{ color: 'var(--text)', textDecoration: 'none', flex: 1 }}>
          My jobs
        </Link>
        <span className="mono muted">{contractorId.slice(0, 8)}…</span>
        <button type="button" onClick={logout}>
          Log out
        </button>
      </header>
      <div style={{ padding: 20, maxWidth: 720, width: '100%', margin: '0 auto' }}>
        {children}
      </div>
    </div>
  );
}

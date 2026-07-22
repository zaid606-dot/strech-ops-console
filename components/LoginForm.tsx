'use client';

import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { safeOpsNextPath } from '@/lib/auth/paths';

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Login failed (${res.status})`);
        return;
      }
      router.replace(safeOpsNextPath(search.get('next')));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background:
          'radial-gradient(ellipse at 20% 0%, #1a2a3a 0%, transparent 50%), var(--bg)',
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: '100%',
          maxWidth: 360,
          display: 'grid',
          gap: 14,
          padding: 28,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 6,
        }}
      >
        <div>
          <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>
            STRECH
          </div>
          <h1 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 600 }}>Ops desk</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Restricted dispatch console. Authorized operators only.
          </p>
        </div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span className="muted">Username</span>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span className="muted">Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
        </label>
        {error ? <div className="err">{error}</div> : null}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Enter desk'}
        </button>
      </form>
    </main>
  );
}

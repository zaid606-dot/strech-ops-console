'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
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
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? body.error ?? `Login failed (${res.status})`);
        return;
      }
      router.replace('/ops');
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
          <h1 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 600 }}>Ops console</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Enter the ops dev token to mint <span className="mono">role=ops</span> against
            dispatch.
          </p>
        </div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span className="muted">OPS_DEV_TOKEN</span>
          <input
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
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

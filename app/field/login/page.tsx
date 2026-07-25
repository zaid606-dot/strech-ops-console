'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function FieldLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [contractorId, setContractorId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/field/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, contractorId: contractorId.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Login failed (${res.status})`);
        return;
      }
      router.replace('/field');
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
          'radial-gradient(ellipse at 80% 0%, #1a2e24 0%, transparent 45%), var(--bg)',
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: '100%',
          maxWidth: 400,
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
          <h1 style={{ margin: '4px 0 0', fontSize: 22, fontWeight: 600 }}>Field</h1>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Contractor portal — UUID + field password. Restricted access.
          </p>
        </div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span className="muted">Contractor ID (UUID)</span>
          <input
            className="mono"
            value={contractorId}
            onChange={(e) => setContractorId(e.target.value)}
            placeholder="from ops Contractors page"
            required
          />
        </label>
        <label style={{ display: 'grid', gap: 6 }}>
          <span className="muted">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
        </label>
        {error ? <div className="err">{error}</div> : null}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Open jobs'}
        </button>
        <a href="/login" className="muted" style={{ fontSize: 12 }}>
          Ops desk login →
        </a>
      </form>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Offer = {
  id: string;
  service_request_id: string;
  contractor_id: string;
  full_name: string;
  confirmation_code: string | null;
  request_status: string;
  status: string;
  rank: number;
  slot_start: string;
  slot_end: string;
  expires_at: string;
  reply_token: string;
  score: string | number | null;
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function ttlSeconds(expiresAt: string) {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

export default function OffersPage() {
  const [items, setItems] = useState<Offer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/ops/offers?status=pending');
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        setItems([]);
        return;
      }
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load offers');
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function seedContractor() {
    setSeeding(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/ops/seed-contractor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category_id: 'hvac', zip: '78701' }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Seed contractor failed');
        return;
      }
      setMsg(`Seeded contractor ${body.contractor?.full_name}`);
    } finally {
      setSeeding(false);
    }
  }

  async function startWave(requestId: string) {
    setBusy(`wave-${requestId}`);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/ops/requests/${requestId}/offer-wave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: 'parallel_batch', batch_size: 3 }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.detail ?? body.error}${body.code ? ` [${body.code}]` : ''}`);
        return;
      }
      setMsg(
        body.escalated
          ? 'No candidates — escalated to ops'
          : `Wave created with ${body.offers?.length ?? 0} offer(s)`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function act(offer: Offer, action: 'accept' | 'decline') {
    setBusy(`${action}-${offer.id}`);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/ops/offers/${offer.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'accept' ? { contractor_id: offer.contractor_id } : {},
        ),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(`${body.detail ?? body.error}${body.code ? ` [${body.code}]` : ''}`);
        return;
      }
      setMsg(action === 'accept' ? `Accepted — job booked` : `Declined ${offer.reply_token}`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const byRequest = items.reduce<Record<string, Offer[]>>((acc, o) => {
    (acc[o.service_request_id] ??= []).push(o);
    return acc;
  }, {});

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Offer radar</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Pending offers with TTL. Accept/Decline stand-in for SMS. Refresh 5s.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" disabled={seeding} onClick={() => void seedContractor()}>
            {seeding ? 'Seeding pro…' : 'Seed contractor'}
          </button>
          <button type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </div>

      {error ? <p className="err">{error}</p> : null}
      {msg ? <p className="ok">{msg}</p> : null}

      <p className="muted" style={{ margin: 0 }}>
        Tip: <Link href="/ops/pool">Pool</Link> → open a job → use “Start offer wave” below when
        pending offers are empty, or seed a contractor first for {`78701/hvac`}.
      </p>

      {Object.keys(byRequest).length === 0 ? (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 16,
            background: 'var(--bg-elevated)',
          }}
        >
          <p className="muted" style={{ margin: 0 }}>
            No pending offers. Seed a request + contractor, then start a wave from a pool job id.
          </p>
          <WaveById onDone={() => void load()} />
        </div>
      ) : null}

      {Object.entries(byRequest).map(([requestId, offers]) => (
        <section
          key={requestId}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--bg-elevated)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <Link href={`/ops/requests/${requestId}`} className="mono">
                {offers[0]?.confirmation_code ?? requestId.slice(0, 8)}
              </Link>
              <span className="muted"> · </span>
              <span className={`pill ${offers[0]?.request_status}`}>
                {offers[0]?.request_status}
              </span>
            </div>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void startWave(requestId)}
            >
              {busy === `wave-${requestId}` ? 'Starting…' : 'New wave'}
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Pro</th>
                <th>Slot</th>
                <th>TTL</th>
                <th>Token</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offers.map((o) => {
                const ttl = ttlSeconds(o.expires_at);
                return (
                  <tr key={o.id}>
                    <td className="mono">{o.rank}</td>
                    <td>
                      {o.full_name}
                      <div className="mono muted">{o.contractor_id.slice(0, 8)}</div>
                    </td>
                    <td className="mono muted">
                      {fmt(o.slot_start)}
                      <br />
                      {fmt(o.slot_end)}
                    </td>
                    <td>
                      <div
                        style={{
                          height: 6,
                          width: 80,
                          background: 'var(--bg)',
                          borderRadius: 3,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(100, (ttl / 600) * 100)}%`,
                            background: ttl < 60 ? 'var(--danger)' : 'var(--accent)',
                          }}
                        />
                      </div>
                      <span className="mono muted">{ttl}s</span>
                    </td>
                    <td className="mono">{o.reply_token}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="primary"
                        type="button"
                        disabled={!!busy}
                        onClick={() => void act(o, 'accept')}
                      >
                        Accept
                      </button>{' '}
                      <button
                        type="button"
                        disabled={!!busy}
                        onClick={() => void act(o, 'decline')}
                      >
                        Decline
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function WaveById({ onDone }: { onDone: () => void }) {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/ops/requests/${id.trim()}/offer-wave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy: 'parallel_batch', batch_size: 3 }),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body.detail ?? body.error ?? 'Wave failed');
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
      <input
        className="mono"
        placeholder="service_request_id"
        value={id}
        onChange={(e) => setId(e.target.value)}
        style={{ flex: 1, minWidth: 240 }}
      />
      <button className="primary" type="button" disabled={busy || !id.trim()} onClick={() => void run()}>
        {busy ? 'Starting…' : 'Start offer wave'}
      </button>
      {err ? <span className="err">{err}</span> : null}
    </div>
  );
}

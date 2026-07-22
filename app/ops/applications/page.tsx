'use client';

import { useCallback, useEffect, useState } from 'react';

type Application = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  categories: string[];
  service_zips: string[];
  metro_id: string | null;
  notes: string | null;
  status: string;
  contractor_id: string | null;
  created_at: string;
};

export default function ApplicationsPage() {
  const [items, setItems] = useState<Application[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/ops/applications?status=pending');
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        return;
      }
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept(id: string, approve: boolean) {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/ops/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: id, approve }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Accept failed');
        return;
      }
      setMsg(
        approve
          ? `Accepted + approved contractor ${body.contractor_id ?? body.id}`
          : `Accepted contractor ${body.contractor_id ?? body.id}`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Applications</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Waitlist / contractor intake. Accept creates a contractor; Approve also sets vetted.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
      {msg ? <p className="ok">{msg}</p> : null}
      <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Categories</th>
              <th>Zips</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No pending applications.
                </td>
              </tr>
            ) : null}
            {items.map((a) => (
              <tr key={a.id}>
                <td>
                  <div>{a.full_name}</div>
                  <div className="mono muted" style={{ fontSize: 11 }}>
                    {a.id.slice(0, 8)}
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 13 }}>
                  {a.email ?? '—'}
                  <br />
                  {a.phone ?? '—'}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {(a.categories ?? []).join(', ') || '—'}
                </td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {(a.service_zips ?? []).join(', ') || '—'}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void accept(a.id, false)}
                    style={{ marginRight: 6 }}
                  >
                    Accept
                  </button>
                  <button type="button" disabled={busy} onClick={() => void accept(a.id, true)}>
                    Accept + approve
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

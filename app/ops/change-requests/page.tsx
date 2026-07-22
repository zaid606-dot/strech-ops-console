'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type ChangeRequest = {
  id: string;
  service_request_id: string;
  kind: string;
  status: string;
  preferred_window_start: string | null;
  preferred_window_end: string | null;
  note: string | null;
  category_id: string;
  confirmation_code: string | null;
  request_status: string;
  created_at: string;
};

export default function ChangeRequestsPage() {
  const [items, setItems] = useState<ChangeRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/ops/change-requests');
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Change requests</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Blind member reschedule asks. Use request desk to reschedule the slot.
          </p>
        </div>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error ? <p className="err">{error}</p> : null}
      <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Kind</th>
              <th>Request status</th>
              <th>Preferred window</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No open change requests.
                </td>
              </tr>
            ) : null}
            {items.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/ops/requests/${r.service_request_id}`} className="mono">
                    {r.confirmation_code ?? r.service_request_id.slice(0, 8)}
                  </Link>
                </td>
                <td>{r.kind}</td>
                <td>
                  <span className={`pill ${r.request_status}`}>{r.request_status}</span>
                </td>
                <td className="mono muted" style={{ fontSize: 12 }}>
                  {r.preferred_window_start ?? '—'}
                  <br />
                  {r.preferred_window_end ?? '—'}
                </td>
                <td>{r.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type JobItem = {
  appointment: {
    id: string;
    service_request_id: string;
    slot_start: string;
    slot_end: string;
    status: string;
  };
  request: {
    id: string;
    status: string;
    category_id: string;
    confirmation_code: string | null;
  };
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function FieldJobs() {
  const [items, setItems] = useState<JobItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/field/jobs');
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        setItems([]);
        return;
      }
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 16,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>My jobs</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Booked / confirmed / on-site jobs for this contractor.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <div style={{ display: 'grid', gap: 10 }}>
        {items.length === 0 && !loading ? (
          <p className="muted">No active jobs.</p>
        ) : null}
        {items.map((job) => (
          <Link
            key={job.appointment.id}
            href={`/field/jobs/${job.request.id}`}
            style={{
              display: 'block',
              padding: 14,
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--bg-elevated)',
              textDecoration: 'none',
              color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong className="mono">
                {job.request.confirmation_code ?? job.request.id.slice(0, 8)}
              </strong>
              <span className={`pill ${job.request.status}`}>{job.request.status}</span>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              {job.request.category_id}
            </div>
            <div className="mono muted" style={{ marginTop: 4, fontSize: 12 }}>
              {fmt(job.appointment.slot_start)} → {fmt(job.appointment.slot_end)}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

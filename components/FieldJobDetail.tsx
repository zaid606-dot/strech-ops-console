'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type JobItem = {
  appointment: {
    id: string;
    slot_start: string;
    slot_end: string;
  };
  request: {
    id: string;
    status: string;
    category_id: string;
    confirmation_code: string | null;
    property_id: string;
  };
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function FieldJobDetail({ requestId }: { requestId: string }) {
  const [job, setJob] = useState<JobItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/field/jobs');
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        return;
      }
      const items = (body.items ?? []) as JobItem[];
      const found = items.find((j) => j.request.id === requestId) ?? null;
      setJob(found);
      if (!found) setError('Job not in your active list (wrong contractor or not booked).');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(kind: 'check-in' | 'complete') {
    setBusy(kind);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/field/jobs/${requestId}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'complete' ? { summary: 'Work completed on site' } : { note: 'Arrived on site' },
        ),
      });
      const body = await res.json();
      if (!res.ok) {
        const code = body.code ? ` [${body.code}]` : '';
        setError(`${body.detail ?? body.error ?? `${kind} failed`}${code}`);
        return;
      }
      setMsg(kind === 'check-in' ? 'Checked in — job in progress' : 'Job completed');
      if (body?.status && job) {
        setJob({
          ...job,
          request: { ...job.request, status: String(body.status) },
        });
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!job && !error) return <p className="muted">Loading…</p>;

  const status = job?.request.status;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <Link href="/field" className="muted">
          ← My jobs
        </Link>
        <h1 style={{ margin: '8px 0 0', fontSize: 22 }}>
          {job?.request.confirmation_code ?? requestId.slice(0, 8)}
        </h1>
        {job ? (
          <p className="muted" style={{ margin: '4px 0 0' }}>
            <span className={`pill ${job.request.status}`}>{job.request.status}</span>
            {' · '}
            {job.request.category_id}
          </p>
        ) : null}
      </div>

      {error ? <p className="err">{error}</p> : null}
      {msg ? <p className="ok">{msg}</p> : null}

      {job ? (
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 14,
            background: 'var(--bg-elevated)',
          }}
        >
          <div className="mono muted" style={{ fontSize: 12 }}>
            Slot {fmt(job.appointment.slot_start)} → {fmt(job.appointment.slot_end)}
          </div>
          <div className="mono muted" style={{ fontSize: 12, marginTop: 6 }}>
            Property {job.request.property_id.slice(0, 8)}…
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {status === 'confirmed' ? (
              <button
                className="primary"
                type="button"
                disabled={!!busy}
                onClick={() => void action('check-in')}
              >
                {busy === 'check-in' ? 'Checking in…' : 'Check in'}
              </button>
            ) : null}
            {status === 'in_progress' ? (
              <button
                className="primary"
                type="button"
                disabled={!!busy}
                onClick={() => void action('complete')}
              >
                {busy === 'complete' ? 'Completing…' : 'Complete job'}
              </button>
            ) : null}
            {status === 'scheduled' ? (
              <p className="muted" style={{ margin: 0 }}>
                Waiting for ops to confirm the visit.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

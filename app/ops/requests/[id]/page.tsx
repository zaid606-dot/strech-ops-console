'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type {
  Charge,
  ContractorCandidate,
  JobEvent,
  Property,
  ReminderJob,
  ServiceRequest,
} from '@/lib/dispatch/types';

function fmt(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string) {
  return new Date(v).toISOString();
}

export default function RequestDeskPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [request, setRequest] = useState<ServiceRequest | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [reminders, setReminders] = useState<ReminderJob[]>([]);
  const [progress, setProgress] = useState<
    { key: string; label: string; done: boolean; at: string | null }[]
  >([]);
  const [candidates, setCandidates] = useState<ContractorCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [smsBody, setSmsBody] = useState('');

  const [rescheduleStart, setRescheduleStart] = useState('');
  const [rescheduleEnd, setRescheduleEnd] = useState('');
  const [cancelReason, setCancelReason] = useState('Ops cancelled');

  const load = useCallback(async () => {
    setError(null);
    try {
      const reqRes = await fetch(`/api/ops/requests/${id}`);
      const reqBody = await reqRes.json();
      if (!reqRes.ok) {
        setError(reqBody.detail ?? reqBody.error ?? `Load failed (${reqRes.status})`);
        return;
      }
      setRequest(reqBody);

      const [propRes, evRes, chRes, remRes, progRes] = await Promise.all([
        fetch(`/api/ops/properties/${reqBody.property_id}`),
        fetch(`/api/ops/requests/${id}/events`),
        fetch(`/api/ops/requests/${id}/charges`),
        fetch(`/api/ops/requests/${id}/reminders`),
        fetch(`/api/ops/requests/${id}/member-progress`),
      ]);
      const propBody = await propRes.json();
      const evBody = await evRes.json();
      if (propRes.ok) setProperty(propBody);
      if (evRes.ok) setEvents(evBody.items ?? []);
      if (chRes.ok) {
        const chBody = await chRes.json();
        setCharges(chBody.items ?? []);
      } else {
        setCharges([]);
      }
      if (remRes.ok) {
        const remBody = await remRes.json();
        setReminders(remBody.items ?? []);
      } else {
        setReminders([]);
      }
      if (progRes.ok) {
        const progBody = await progRes.json();
        setProgress(progBody.steps ?? []);
      } else {
        setProgress([]);
      }

      const needAvail = ['dispatching', 'booked', 'confirmed'].includes(reqBody.status);
      if (propRes.ok && needAvail) {
        const windowStart =
          reqBody.preferred_window_start ?? new Date().toISOString();
        const qs = new URLSearchParams({
          category_id: reqBody.category_id,
          zip: propBody.zip,
          window_start: windowStart,
        });
        const availRes = await fetch(`/api/ops/contractors/available?${qs}`);
        const availBody = await availRes.json();
        if (availRes.ok) setCandidates(availBody.items ?? []);
        else setCandidates([]);
      } else {
        setCandidates([]);
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const start = new Date();
    start.setDate(start.getDate() + 4);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(12, 0, 0, 0);
    setRescheduleStart(toLocalInputValue(start));
    setRescheduleEnd(toLocalInputValue(end));
  }, []);

  async function postAction(action: string, body: unknown = {}, busyKey = action) {
    setBusy(busyKey);
    setActionMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/ops/requests/${id}/actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = data.code ? ` [${data.code}]` : '';
        setError(`${data.detail ?? data.error ?? `${action} failed`}${code}`);
        return false;
      }
      setActionMsg(`${action} ok`);
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function postNamed(path: string, busyKey: string, body: unknown = {}) {
    setBusy(busyKey);
    setActionMsg(null);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = data.code ? ` [${data.code}]` : '';
        setError(`${data.detail ?? data.error ?? `${busyKey} failed`}${code}`);
        return false;
      }
      setActionMsg(`${busyKey} ok`);
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function fireReminders() {
    await postNamed('/api/ops/fire-reminders', 'fire-reminders', {});
  }

  async function simulateSms(text: string) {
    await postNamed('/api/ops/simulate-sms', 'simulate-sms', { body: text });
  }

  async function book(c: ContractorCandidate) {
    setBusy(c.contractor_id);
    setActionMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/ops/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_request_id: id,
          contractor_id: c.contractor_id,
          slot_start: c.next_open_slot_start,
          slot_end: c.next_open_slot_end,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        const code = body.code ? ` [${body.code}]` : '';
        setError(`${body.detail ?? body.error ?? 'Book failed'}${code}`);
        return;
      }
      setActionMsg(`Booked appointment ${body.id}`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!request && !error) {
    return <p className="muted">Loading…</p>;
  }

  const status = request?.status;
  const showBook = status === 'dispatching';
  const showAck = status === 'booked' && !request?.arrival_acked_at;
  const showConfirmVisit = status === 'booked' && !!request?.arrival_acked_at;
  const showUnassign = status === 'booked' && !request?.arrival_acked_at;
  const showReschedule = status === 'booked' || status === 'confirmed';
  const showReassign = status === 'booked' || status === 'confirmed';
  const showNoShow = status === 'confirmed';
  const showRedispatch = status === 'no_show' || status === 'needs_review';
  const showCancel =
    status != null &&
    !['cancelled', 'closed', 'completed', 'reviewed'].includes(status);
  const showClose = status === 'reviewed' || status === 'completed';
  const activeCharge = charges.find((c) => c.status !== 'voided') ?? null;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <Link href="/ops" className="muted">
          ← Pool
        </Link>
        {' · '}
        <Link href="/ops/board" className="muted">
          Board
        </Link>
        <h1 style={{ margin: '8px 0 0', fontSize: 22 }}>
          {request?.confirmation_code ?? id.slice(0, 8)}
        </h1>
        {request ? (
          <p className="muted" style={{ margin: '4px 0 0' }}>
            <span className={`pill ${request.status}`}>{request.status}</span>
            {' · '}
            {request.category_id}
            {property ? ` · ${property.city}, ${property.state} ${property.zip}` : null}
          </p>
        ) : null}
      </div>

      {error ? <p className="err">{error}</p> : null}
      {actionMsg ? <p className="ok">{actionMsg}</p> : null}

      {request ? (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
          }}
        >
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 14,
              background: 'var(--bg-elevated)',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>Request</h2>
            <dl
              style={{
                margin: 0,
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                gap: '6px 10px',
              }}
            >
              <dt className="muted">ID</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {request.id}
              </dd>
              <dt className="muted">Window</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {fmt(request.preferred_window_start)} → {fmt(request.preferred_window_end)}
              </dd>
              <dt className="muted">Contractor</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {request.assigned_contractor_id ?? '—'}
              </dd>
              <dt className="muted">Appointment</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {request.appointment_id ?? '—'}
              </dd>
              <dt className="muted">Arrival ack</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {request.arrival_acked_at ? fmt(request.arrival_acked_at) : '—'}
              </dd>
              <dt className="muted">Confirmed at</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {request.confirmed_at ? fmt(request.confirmed_at) : '—'}
              </dd>
              <dt className="muted">Details</dt>
              <dd className="mono" style={{ margin: 0 }}>
                {JSON.stringify(request.details)}
              </dd>
            </dl>

            <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {showAck ? (
                <button
                  className="primary"
                  type="button"
                  disabled={busy === 'ack-arrival'}
                  onClick={() =>
                    void postNamed(
                      `/api/ops/requests/${id}/ack-arrival`,
                      'ack-arrival',
                    )
                  }
                >
                  {busy === 'ack-arrival' ? 'Acking…' : 'Ack arrival (ops stand-in)'}
                </button>
              ) : null}
              {showConfirmVisit ? (
                <button
                  className="primary"
                  type="button"
                  disabled={busy === 'confirm-visit'}
                  onClick={() =>
                    void postNamed(
                      `/api/ops/requests/${id}/confirm-visit`,
                      'confirm-visit',
                    )
                  }
                >
                  {busy === 'confirm-visit' ? 'Confirming…' : 'Confirm visit'}
                </button>
              ) : null}
              {status === 'booked' && !request.arrival_acked_at ? (
                <p className="muted" style={{ margin: 0, width: '100%' }}>
                  Confirm visit unlocks after <span className="mono">ack_arrival</span>.
                </p>
              ) : null}
            </div>
          </div>

          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 14,
              background: 'var(--bg-elevated)',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>Property</h2>
            {property ? (
              <p style={{ margin: 0 }}>
                {property.address_line1}
                <br />
                {property.city}, {property.state} {property.zip}
              </p>
            ) : (
              <p className="muted">No property loaded</p>
            )}
          </div>
        </section>
      ) : null}

      {request ? (
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 14,
            background: 'var(--bg-elevated)',
          }}
        >
          <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>Field progress</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
            {progress.length === 0 ? (
              <span className="muted">No progress yet</span>
            ) : (
              progress.map((s) => (
                <span
                  key={s.key}
                  className={s.done ? 'ok' : 'muted'}
                  style={{ fontSize: 13 }}
                >
                  {s.done ? '●' : '○'} {s.label}
                  {s.at ? (
                    <span className="mono muted" style={{ marginLeft: 6, fontSize: 11 }}>
                      {fmt(s.at)}
                    </span>
                  ) : null}
                </span>
              ))
            )}
          </div>
          {['confirmed', 'checked_in'].includes(request.status) && request.confirmation_code ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
              <input
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                placeholder={`e.g. ARRIVED ${request.confirmation_code}`}
                className="mono"
              />
              <button
                type="button"
                disabled={busy === 'simulate-sms' || !smsBody.trim()}
                onClick={() => void simulateSms(smsBody.trim())}
              >
                Simulate SMS
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      {request ? (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
          }}
        >
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 14,
              background: 'var(--bg-elevated)',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 14 }}>Money</h2>
            {activeCharge ? (
              <dl
                style={{
                  margin: 0,
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr',
                  gap: '6px 10px',
                }}
              >
                <dt className="muted">Charge</dt>
                <dd className="mono" style={{ margin: 0 }}>
                  ${(activeCharge.amount_cents / 100).toFixed(2)}{' '}
                  <span className={`pill ${activeCharge.status}`}>{activeCharge.status}</span>
                </dd>
                <dt className="muted">Tier</dt>
                <dd style={{ margin: 0 }}>{activeCharge.membership_tier}</dd>
                <dt className="muted">Note</dt>
                <dd className="muted" style={{ margin: 0 }}>
                  {activeCharge.note ?? '—'}
                </dd>
              </dl>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                No charge yet — created on <span className="mono">confirm_visit</span>.
              </p>
            )}
          </div>

          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 14,
              background: 'var(--bg-elevated)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <h2 style={{ margin: 0, fontSize: 14 }}>Reminders</h2>
              <button
                type="button"
                disabled={busy === 'fire-reminders'}
                onClick={() => void fireReminders()}
              >
                {busy === 'fire-reminders' ? 'Firing…' : 'Fire due'}
              </button>
            </div>
            {reminders.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                None scheduled — T-24 / T-2 / T-30 after confirm.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Fire at</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reminders.map((r) => (
                    <tr key={r.id}>
                      <td className="mono">{r.kind}</td>
                      <td className="mono muted">{fmt(r.fire_at)}</td>
                      <td>
                        <span className={`pill ${r.status}`}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      ) : null}

      {showBook ? (
        <section
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
              alignItems: 'center',
            }}
          >
            <h2 style={{ margin: 0, fontSize: 14 }}>Available contractors</h2>
            <button type="button" onClick={() => void load()}>
              Reload
            </button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Pro</th>
                <th>Rating</th>
                <th>Suggested slot</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No approved contractors for this category/zip. Approve one under
                    Contractors.
                  </td>
                </tr>
              ) : null}
              {candidates.map((c) => (
                <tr key={c.contractor_id}>
                  <td>
                    {c.full_name}
                    <div className="mono muted">{c.contractor_id.slice(0, 8)}</div>
                  </td>
                  <td>{c.rating ?? '—'}</td>
                  <td className="mono muted">
                    {fmt(c.next_open_slot_start)}
                    <br />
                    {fmt(c.next_open_slot_end)}
                  </td>
                  <td>
                    <button
                      className="primary"
                      type="button"
                      disabled={busy === c.contractor_id}
                      onClick={() => void book(c)}
                    >
                      {busy === c.contractor_id ? 'Booking…' : 'Book'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 14,
          background: 'var(--bg-elevated)',
          display: 'grid',
          gap: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14 }}>Recovery / edits</h2>
        <p className="muted" style={{ margin: 0 }}>
          Actions enable based on current status. Conflicts surface as{' '}
          <span className="mono">SLOT_CONFLICT</span>.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {showUnassign ? (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void postAction('unassign', { note: 'Ops unassign' })}
            >
              Unassign → pool
            </button>
          ) : null}

          {showNoShow ? (
            <>
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void postAction('no-show', { party: 'contractor', note: 'Contractor no-show' })
                }
              >
                No-show (contractor)
              </button>
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void postAction('no-show', { party: 'homeowner', note: 'Member no-show' })
                }
              >
                No-show (member)
              </button>
            </>
          ) : null}

          {showRedispatch ? (
            <button
              className="primary"
              type="button"
              disabled={!!busy}
              onClick={() => void postAction('redispatch', { note: 'Back to pool' })}
            >
              Redispatch → pool
            </button>
          ) : null}

          {showClose ? (
            <button
              className="primary"
              type="button"
              disabled={!!busy}
              onClick={() => void postAction('close', { note: 'Ops closed job' })}
            >
              Close job
            </button>
          ) : null}
        </div>

        {showReschedule ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr auto',
              gap: 8,
              alignItems: 'end',
            }}
          >
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">New slot start</span>
              <input
                type="datetime-local"
                value={rescheduleStart}
                onChange={(e) => setRescheduleStart(e.target.value)}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="muted">New slot end</span>
              <input
                type="datetime-local"
                value={rescheduleEnd}
                onChange={(e) => setRescheduleEnd(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!!busy || !rescheduleStart || !rescheduleEnd}
              onClick={() =>
                void postAction('reschedule', {
                  slot_start: fromLocalInputValue(rescheduleStart),
                  slot_end: fromLocalInputValue(rescheduleEnd),
                  note: 'Ops reschedule',
                })
              }
            >
              Reschedule (same pro)
            </button>
          </div>
        ) : null}

        {showReassign && candidates.length > 0 ? (
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }} className="muted">
              Reassign to another approved pro
            </h3>
            <table>
              <thead>
                <tr>
                  <th>Pro</th>
                  <th>Slot</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {candidates
                  .filter((c) => c.contractor_id !== request?.assigned_contractor_id)
                  .map((c) => (
                    <tr key={c.contractor_id}>
                      <td>{c.full_name}</td>
                      <td className="mono muted">{fmt(c.next_open_slot_start)}</td>
                      <td>
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() =>
                            void postAction(
                              'reassign',
                              {
                                contractor_id: c.contractor_id,
                                slot_start: c.next_open_slot_start,
                                slot_end: c.next_open_slot_end,
                                note: 'Ops reassign',
                              },
                              `reassign-${c.contractor_id}`,
                            )
                          }
                        >
                          Reassign
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {showCancel ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Cancel reason"
            />
            <button
              className="danger"
              type="button"
              disabled={!!busy || !cancelReason.trim()}
              onClick={() => void postAction('cancel', { reason: cancelReason.trim() })}
            >
              Cancel request
            </button>
          </div>
        ) : null}
      </section>

      <section
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
          }}
        >
          <h2 style={{ margin: 0, fontSize: 14 }}>Events</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Transition</th>
              <th>Actor</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  No events
                </td>
              </tr>
            ) : null}
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className="mono muted">{fmt(ev.created_at)}</td>
                <td className="mono">
                  {ev.from_status ?? '∅'} → {ev.to_status}
                </td>
                <td className="mono muted">
                  {ev.actor_role}/{ev.actor_id.slice(0, 8)}
                </td>
                <td>{ev.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

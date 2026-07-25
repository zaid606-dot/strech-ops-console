'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

import type { Contractor } from '@/lib/dispatch/types';

type AvailSlot = {
  id: string;
  slot_start: string;
  slot_end: string;
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function ContractorsPage() {
  const [items, setItems] = useState<Contractor[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [categories, setCategories] = useState('hvac');
  const [zips, setZips] = useState('');
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [availFor, setAvailFor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [slots, setSlots] = useState<AvailSlot[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const loadAvailability = useCallback(async (id: string) => {
    setSlotsError(null);
    try {
      const res = await fetch(`/api/ops/contractors/${id}/availability`);
      const body = await res.json();
      if (!res.ok) {
        setSlots([]);
        setSlotsError(body.detail ?? body.error ?? 'Availability failed');
        return;
      }
      setSlots(body.items ?? []);
    } catch (e) {
      setSlots([]);
      setSlotsError(e instanceof Error ? e.message : 'Availability failed');
    }
  }, []);

  const load = useCallback(
    async (preferId?: string | null) => {
      setError(null);
      try {
        const res = await fetch('/api/ops/contractors');
        const body = await res.json();
        if (!res.ok) {
          setError(body.detail ?? body.error ?? `Failed (${res.status})`);
          return;
        }
        const next = (body.items ?? []) as Contractor[];
        setItems(next);
        if (next.length > 0) {
          const prefer = preferId ?? selectedId;
          const pick =
            prefer && next.some((c) => c.id === prefer) ? prefer : next[0].id;
          setSelectedId(pick);
          await loadAvailability(pick);
        } else {
          setSelectedId(null);
          setSlots([]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    },
    [loadAvailability, selectedId],
  );

  useEffect(() => {
    void load();
    // initial load only — selection changes via selectContractor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectContractor(id: string) {
    setSelectedId(id);
    await loadAvailability(id);
  }

  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setMsg('Contractor ID copied');
    } catch {
      setError('Copy failed');
    }
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch('/api/ops/contractors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          categories: categories
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          service_zips: zips
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Create failed');
        return;
      }
      setMsg(`Created ${body.full_name} — approve + add availability before offering`);
      setFullName('');
      setEmail('');
      setPhone('');
      await load(body.id as string);
    } finally {
      setBusy(false);
    }
  }

  async function addAvailability(id: string) {
    if (!slotStart || !slotEnd) {
      setError('Set slot start/end before adding availability');
      return;
    }
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/ops/contractors/${id}/availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot_start: new Date(slotStart).toISOString(),
          slot_end: new Date(slotEnd).toISOString(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Availability failed');
        return;
      }
      setMsg(`Availability added for ${id.slice(0, 8)}`);
      setAvailFor(null);
      setSelectedId(id);
      await loadAvailability(id);
    } finally {
      setBusy(false);
    }
  }

  async function setVetting(id: string, vetting_status: 'approved' | 'suspended') {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch(`/api/ops/contractors/${id}/vetting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vetting_status,
          documents_verified: vetting_status === 'approved' ? ['license'] : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? 'Vetting update failed');
        return;
      }
      setMsg(`${body.full_name} → ${body.vetting_status}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const selected = items.find((c) => c.id === selectedId) ?? null;

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>Contractors</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Real pros only. Create → Approve → add availability slots. Only{' '}
          <span className="mono">approved</span> with open slots appear for offers.
        </p>
      </div>

      {error ? <p className="err">{error}</p> : null}
      {msg ? <p className="ok">{msg}</p> : null}

      <form
        onSubmit={onCreate}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 14,
          background: 'var(--bg-elevated)',
          display: 'grid',
          gap: 10,
          gridTemplateColumns: '1fr 1fr',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, gridColumn: '1 / -1' }}>Add contractor</h2>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted">Full name</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted">Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted">Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted">Categories (comma)</span>
          <input value={categories} onChange={(e) => setCategories(e.target.value)} required />
        </label>
        <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
          <span className="muted">Service zips (comma)</span>
          <input
            value={zips}
            onChange={(e) => setZips(e.target.value)}
            placeholder="78701,78702"
            required
          />
        </label>
        <div style={{ gridColumn: '1 / -1' }}>
          <button className="primary" type="submit" disabled={busy}>
            Create
          </button>
        </div>
      </form>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 14,
          background: 'var(--bg-elevated)',
          display: 'grid',
          gap: 10,
          gridTemplateColumns: '1fr 1fr auto',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted">Availability slot start</span>
          <input
            type="datetime-local"
            value={slotStart}
            onChange={(e) => setSlotStart(e.target.value)}
          />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted">Slot end</span>
          <input type="datetime-local" value={slotEnd} onChange={(e) => setSlotEnd(e.target.value)} />
        </label>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Select a contractor → Add slot
        </p>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Name / ID</th>
              <th>Contact</th>
              <th>Status</th>
              <th>Categories</th>
              <th>Zips</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
                  No contractors. Add one, then approve and add availability.
                </td>
              </tr>
            ) : null}
            {items.map((c) => (
              <tr
                key={c.id}
                style={{
                  background: selectedId === c.id ? 'var(--bg)' : undefined,
                  cursor: 'pointer',
                }}
                onClick={() => void selectContractor(c.id)}
              >
                <td>
                  <div>{c.full_name}</div>
                  <div
                    className="mono muted"
                    style={{ fontSize: 11, wordBreak: 'break-all', marginTop: 2 }}
                  >
                    {c.id}
                  </div>
                  <button
                    type="button"
                    style={{ marginTop: 4, fontSize: 11 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyId(c.id);
                    }}
                  >
                    Copy
                  </button>
                </td>
                <td>
                  <div className="mono" style={{ fontSize: 12 }}>
                    {c.phone ?? '—'}
                  </div>
                  <div className="mono muted" style={{ fontSize: 12 }}>
                    {c.email ?? '—'}
                  </div>
                </td>
                <td>
                  <span className={`pill ${c.vetting_status}`}>{c.vetting_status}</span>
                </td>
                <td className="mono muted">{c.categories.join(', ') || '—'}</td>
                <td className="mono muted">{c.service_zips.join(', ') || '—'}</td>
                <td
                  style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    disabled={busy || c.vetting_status === 'approved'}
                    onClick={() => void setVetting(c.id, 'approved')}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busy || !slotStart || !slotEnd}
                    onClick={() => {
                      setAvailFor(c.id);
                      void addAvailability(c.id);
                    }}
                  >
                    {availFor === c.id && busy ? 'Adding…' : 'Add slot'}
                  </button>
                  <button
                    className="danger"
                    type="button"
                    disabled={busy || c.vetting_status === 'suspended'}
                    onClick={() => void setVetting(c.id, 'suspended')}
                  >
                    Suspend
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 14,
            background: 'var(--bg-elevated)',
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>
            Upcoming availability — {selected.full_name}
          </h2>
          {slotsError ? <p className="err">{slotsError}</p> : null}
          {slots.length === 0 && !slotsError ? (
            <p className="muted" style={{ margin: 0 }}>
              No upcoming slots. Add one above.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {slots.map((s) => (
                <li key={s.id} className="mono" style={{ fontSize: 13 }}>
                  {fmt(s.slot_start)} → {fmt(s.slot_end)}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

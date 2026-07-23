'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

import type { Contractor } from '@/lib/dispatch/types';

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

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/ops/contractors');
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Failed (${res.status})`);
        return;
      }
      setItems(body.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
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
          Pick a contractor below → Add slot
        </p>
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Categories</th>
              <th>Zips</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No contractors yet.
                </td>
              </tr>
            ) : null}
            {items.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.full_name}
                  <div className="mono muted">{c.id.slice(0, 8)}</div>
                </td>
                <td>
                  <span className={`pill ${c.vetting_status}`}>{c.vetting_status}</span>
                </td>
                <td className="mono muted">{c.categories.join(', ') || '—'}</td>
                <td className="mono muted">{c.service_zips.join(', ') || '—'}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
    </div>
  );
}

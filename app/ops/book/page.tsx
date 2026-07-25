'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function BookVisitPage() {
  const router = useRouter();
  const defaults = useMemo(() => {
    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(12, 0, 0, 0);
    return { start: toLocalInputValue(start), end: toLocalInputValue(end) };
  }, []);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [tier, setTier] = useState('Comfort');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [timezone, setTimezone] = useState('America/Chicago');
  const [category, setCategory] = useState('hvac');
  const [windowStart, setWindowStart] = useState(defaults.start);
  const [windowEnd, setWindowEnd] = useState(defaults.end);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/ops/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          member: {
            full_name: fullName.trim(),
            email: email.trim() || null,
            phone: phone.trim() || null,
            membership_tier: tier,
          },
          property: {
            address_line1: address1.trim(),
            address_line2: address2.trim() || null,
            city: city.trim(),
            state: state.trim(),
            zip: zip.trim(),
            timezone,
          },
          request: {
            category_id: category,
            preferred_window_start: new Date(windowStart).toISOString(),
            preferred_window_end: new Date(windowEnd).toISOString(),
            details: notes.trim() ? { notes: notes.trim() } : {},
            note: 'ops booked real member visit',
          },
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.detail ?? body.error ?? `Book failed (${res.status})`);
        return;
      }
      const id = body.request?.id as string | undefined;
      if (id) router.push(`/ops/requests/${id}`);
      else router.push('/ops/pool');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 20, maxWidth: 720 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 22 }}>Book visit</h1>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Enter real member + property info. Lands in the dispatch pool with a full audit trail.
        </p>
      </div>

      {error ? <p className="err">{error}</p> : null}

      <form
        onSubmit={onSubmit}
        style={{
          display: 'grid',
          gap: 14,
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: 16,
          background: 'var(--bg-elevated)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14 }}>Member</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
            <span className="muted">Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1…" />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">Membership tier</span>
            <select value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="Free">Free</option>
              <option value="Comfort">Comfort</option>
              <option value="Premium">Premium</option>
            </select>
          </label>
        </div>

        <h2 style={{ margin: '8px 0 0', fontSize: 14 }}>Property</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
            <span className="muted">Address line 1</span>
            <input value={address1} onChange={(e) => setAddress1(e.target.value)} required />
          </label>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
            <span className="muted">Address line 2</span>
            <input value={address2} onChange={(e) => setAddress2(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">City</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} required />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">State</span>
            <input value={state} onChange={(e) => setState(e.target.value)} required />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">ZIP</span>
            <input value={zip} onChange={(e) => setZip(e.target.value)} required />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">Timezone</span>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
          </label>
        </div>

        <h2 style={{ margin: '8px 0 0', fontSize: 14 }}>Visit</h2>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="hvac">HVAC</option>
              <option value="landscaping">Landscaping</option>
              <option value="appliance">Appliance</option>
              <option value="plumbing">Plumbing</option>
              <option value="roof">Roof</option>
            </select>
          </label>
          <div />
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">Preferred window start</span>
            <input
              type="datetime-local"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted">Preferred window end</span>
            <input
              type="datetime-local"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              required
            />
          </label>
          <label style={{ display: 'grid', gap: 4, gridColumn: '1 / -1' }}>
            <span className="muted">Notes (stored on request)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Booking…' : 'Add to dispatch pool'}
          </button>
          <Link href="/ops/pool" className="muted">
            Cancel
          </Link>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Email or phone is required. Creates a real member visit in the dispatch pool.
        </p>
      </form>
    </div>
  );
}

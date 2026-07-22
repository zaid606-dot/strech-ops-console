# Strech Ops Console

Phase 3 desk UI: clear the dispatch pool — pick a vetted pro, book a slot, confirm the visit.

**Not Bobo.** This app alone mints `role=ops` actor JWTs. Member apps must never call `/pool`, `/appointments`, or `/contractors/*`.

## Setup

```bash
cp .env.example .env.local
# Match dispatch EDGE_BEARER_TOKEN / ACTOR_JWT_SECRET
npm install
npm run dev   # http://localhost:3002
```

Dispatch must be running (e.g. `localhost:3001`) with migrations through **`008`**.

**Contractor backend connect:** [`docs/CONTRACTOR_CONNECT.md`](./docs/CONTRACTOR_CONNECT.md)

## Desk flow (Gate 3)

1. Log in with `OPS_DEV_TOKEN`
2. **Contractors** → create pro → Approve (categories + zips matching pool jobs)
3. **Pool** / **Board** → open a `dispatching` request
4. Book suggested slot → **Confirm visit**
5. **Recovery** panel for unassign / reschedule / reassign / no-show / redispatch / cancel
6. Suspend a pro → they disappear from available

Or seed from dispatch-api: `npm run seed:ops-contractor`  
API acceptance: `npm run smoke:gate3` in dispatch-api.

## Field portal (Phase 4)

http://localhost:3002/field/login — enter contractor UUID + `FIELD_DEV_TOKEN` (or `OPS_DEV_TOKEN`).

My jobs → Check in (from `confirmed`) → Complete job.

## Docs

See `docs/GATE_3.md`, dispatch `docs/PHASE_3_OPS_CONSOLE.md`, `docs/PHASE_4_FIELD_LOOP.md`.

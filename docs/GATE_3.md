# Gate 3 — Ops desk

## Checklist

- [x] Ops login with `OPS_DEV_TOKEN` (mints `role=ops` only)
- [x] Pool screen (`/ops`)
- [x] Board queues (`/ops/board`)
- [x] Request desk: available → book → confirm
- [x] Events timeline
- [x] Contractors create + approve/suspend
- [x] Recovery: unassign, reschedule, reassign, no-show, redispatch, cancel
- [ ] Live E2E against staging dispatch (run `smoke:gate3` + click through UI)

## API smoke (no UI)

From `strech-dispatch-api` with API up:

```bash
npm run smoke:gate3
```

Covers: book → confirm → member INV-2 → SLOT_CONFLICT → suspend removes from available → board.

## UI path

```bash
# A — dispatch
cd strech-dispatch-api && npm run dev

# B — seed pro (optional if using Contractors UI)
npm run seed:ops-contractor

# C — ops
cd ../strech-ops-console
cp .env.example .env.local
npm run dev   # http://localhost:3002
```

1. Login with `OPS_DEV_TOKEN`
2. Contractors → Approve (or seed)
3. Pool → open `dispatching` job → Book → Confirm
4. Try booking same slot on another job → error shows `SLOT_CONFLICT`
5. Suspend pro → gone from available

## Out of scope (Phase 4+)

- Contractor check-in app
- Production IdP for ops

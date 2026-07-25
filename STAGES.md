# Strech dispatch — build stages

Work protocol (per your instruction):

1. Implement **one stage only**
2. Alignment agent checks core directives (`AGENTS.md` + `cursor-dispatch-brief.md`)
3. Bug-review agent checks the stage diff
4. Explain what shipped → say **DONE**
5. You review → reply **go** → next stage
6. Repeat

Do not start the next stage without **go**.

---

## Stage map

| Stage | Name | Deliverable you can check |
|-------|------|---------------------------|
| **1** | Locked desk shell | ✅ **DONE** — password login, sealed cookies, middleware lock, Overview, Vercel-ready |
| **2** | Dispatch API spine | ✅ **DONE** — `/v1` health, schema, status engine, `job_event`, INV-2 serializer |
| **3** | Book → Pool | ✅ **DONE** — seed/create → live Pool + Overview |
| **4** | Offers → Booked | ✅ **DONE** — scoring, waves, accept race, Offer radar, Board |
| **5** | Confirm + reminders + charge | ✅ **DONE** — `ack_arrival`, `confirm_visit`, pending charge, reminders on desk |
| **6** | Agent runtime | ✅ **DONE** — work queue, policy toggles, tick worker, Agent panel |
| **7** | Field loop | ✅ **DONE** — en-route / check-in / complete, timeline + Field console |
| **8** | Cases + messy paths | ✅ **DONE** — Cases UI, no-show/parts/scope, emergency ingress |
| **9** | Money + review + close | ✅ **DONE** — capture stub, payout held→payable, review → close |
| **10** | Harden + prod smoke | ✅ **DONE** — idempotency, INV-2/PII tests, smoke:full + Vercel runbook |

## Stage 1 acceptance

- [x] Login requires **username + password** from env (not a shared “dev token” field)
- [x] Unauthenticated users cannot reach `/ops/*` or `/api/ops/*`
- [x] Failed auth does not leak whether user or password was wrong
- [x] Session cookies are **HMAC-sealed** (not forgeable JSON)
- [x] Overview loads after login; nav matches watch-desk IA (Offers/Agent/Cases placeholders)
- [x] `npm run build` succeeds (Vercel-ready)
- [x] `.env.example` documents Vercel env vars

## Stage 2 acceptance

- [x] `dispatch-api/` runs with Postgres (`DATABASE_URL`)
- [x] Migration `001_spine.sql` — requests, appointments, contractors, `job_events`, `dispatch_owner`
- [x] Canonical statuses only (no `scheduled` / `paid` / `refunded`)
- [x] `transitionStatus` always writes `job_event` (complete auto-chains to `needs_review`)
- [x] Edge bearer + `X-Strech-Actor` JWT on `/v1`
- [x] Member serializer omits contractor identity (INV-2)
- [x] `npm run test` + `npm run smoke:spine` pass
- [x] H1/H2/H3/H13 locked in brief

## Stage 3 acceptance

- [x] `POST /v1/requests` → `dispatching` + `job_event` + `promise_by`
- [x] `POST /v1/ops/seed-request` for desk demo
- [x] `GET /v1/pool` + `GET /v1/overview`
- [x] Member create response is INV-2 masked
- [x] Agent can read pool; cannot seed
- [x] Console Overview + Pool live counts + Seed button
- [x] `npm run smoke:pool` passes

## Stage 4 acceptance

- [x] Migration `002_offers.sql` — waves, offers, one-accepted unique index, cases stub
- [x] Scoring: vetted + zip/category + load + accept rate + overlapping free slot
- [x] Offer waves (sequential / parallel_batch) + TTL; empty → escalate to ops
- [x] Accept locks **request first** (H10); dual-accept → first wins, loser `OFFER_LOST`
- [x] `SLOT_CONFLICT` / unfit **persist** withdraw (commit, not rollback)
- [x] Agent fence: `OWNED_BY_OPS` on wave/accept; agent allow-listed for wave/accept/decline
- [x] Accept → `booked` + `job_event` via `transitionStatus`
- [x] Console Offer radar + Board with canonical status columns
- [x] `npm run smoke:offers` passes

## Stage 5 acceptance

- [x] Migration `003_confirm.sql` — `charges` + `reminder_jobs` (money ≠ status)
- [x] `POST /v1/requests/:id/ack-arrival` (contractor / ops stand-in)
- [x] `POST /v1/requests/:id/confirm-visit` requires ack + appointment → `confirmed` + `job_event`
- [x] Pending `charge` on confirm (Free > $0; Comfort/Premium included = $0)
- [x] Reminder cadence T-24 / T-2 / T-30; cancel helper; fire worker stub
- [x] Member notify stub masked (INV-2); member-view passes leak assert
- [x] Agent allow-list + `OWNED_BY_OPS` on confirm-visit
- [x] Desk: Ack / Confirm visit + Money + Reminders panels
- [x] `npm run smoke:confirm` passes

## Stage 6 acceptance

- [x] Migration `004_agent.sql` — `agent_policy` + `agent_tick_log`
- [x] `GET /v1/agent/work` attention queue (excludes emergency + ops-owned)
- [x] `GET`/`PATCH /v1/agent/policy` — agent read; ops write only
- [x] `POST /v1/agent/tick` — offer waves, auto `confirm_visit`, escalate stuck/SLA/confirm-off
- [x] Tick mutations always `actor_role=agent` + `job_event`
- [x] Agent 403 on policy write + money (charges)
- [x] Console Agent panel: queue, policy toggles, Run tick now, escalations, tick log
- [x] `npm run smoke:agent` passes

## Stage 7 acceptance

- [x] `GET /v1/contractors/me/jobs` — contractor field list (no medical/safety)
- [x] `POST .../en-route` stays `confirmed` + `job_event`
- [x] `POST .../check-in` → `checked_in`; `POST .../complete` → `needs_review` (auto-chain)
- [x] SMS inbound stub (`OTW`/`ARRIVED`/`DONE` + confirmation_code); garbage escalates
- [x] Member progress projection (INV-2); desk Field progress + Simulate SMS
- [x] Field console: On my way / Check in / Complete (canonical statuses)
- [x] Contractor IDOR on field actions
- [x] `npm run smoke:field` passes

## Stage 8 acceptance

- [x] Cases list API + console (emergencies first); resolve/dismiss ops-only
- [x] No-show → case + status + cancel reminders; redispatch → pool
- [x] Cancel matrix voids pending charge; reject cancel after complete
- [x] `parts_hold` stays `checked_in` + child follow-up (`parent_request_id`)
- [x] `scope_change` open; ops approve amends charge; agent 403 on approve
- [x] `POST /v1/emergency` + per-request panic; agent bypass queue; agent 403 resolve/ingress
- [x] late / cant_find flags; desk Cases panel + messy actions
- [x] `npm run smoke:cases` passes

## Stage 9 acceptance

- [x] Migration `005_money.sql` — payouts, payment_attempts, refunds
- [x] Complete → payout `held` + capture stub (`payment_attempt`); $0 auto-captured
- [x] `ack_completion` + `submit_review` → `reviewed`
- [x] Close guards: `blocks_close`, charge terminal, payout → `payable`
- [x] Dispute → `disputed` + payout stays held; refund rows (charge stays captured)
- [x] Agent 403 on money read/capture/refund
- [x] Desk Money panel: charge + payout + capture/review/refund/close
- [x] `npm run smoke:money` passes

## Stage 10 acceptance

- [x] Migration `006_idempotency.sql` + write middleware (`Idempotency-Key` → replay)
- [x] Expanded INV-2 + PII tier unit tests
- [x] `CONTRACTOR_UNFIT` withdraw covered in `smoke:full`
- [x] Ops audit export `GET /v1/ops/audit/events`
- [x] `npm run smoke:full` — happy path → closed + emergency + idempotent accept
- [x] `npm run smoke:all` runs stage smokes
- [x] README Vercel + hosted API + prod smoke checklist

## Core directives (every stage)

Blind booking · money ≠ status · agent fence in API · every status → `job_event` · `/v1` source of truth · trust > speed

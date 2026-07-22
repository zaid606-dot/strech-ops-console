# Strech dispatch — end-to-end flow plan

Trackable plan for the full job lifecycle. Aligns the product “four flows” with Strech domain vocabulary and invariants in `AGENTS.md`.

**Done test (phase):** console watches real data through  
`dispatching → booked → confirmed → checked_in → completed → needs_review → reviewed → closed`  
(plus money rows + messy-path cases). Member app / SMS / payments processors are stubbed behind `/v1` where needed.

---

## 0. One job, one spine

```mermaid
stateDiagram-v2
  [*] --> dispatching: member books (blind)
  dispatching --> booked: offer accepted / slot locked
  booked --> confirmed: arrival time nailed + member notified
  confirmed --> checked_in: arrived / on-site
  checked_in --> completed: work done (contractor)
  completed --> needs_review: awaiting member review
  needs_review --> reviewed: member reviewed (or timeout policy)
  reviewed --> closed: ops/system close after money settle

  dispatching --> cancelled: member/ops cancel
  booked --> dispatching: decline/timeout release / redispatch
  booked --> cancelled: cancel
  confirmed --> no_show: no-show path
  confirmed --> cancelled: cancel
  checked_in --> disputed: damage/bad work/scope fight
  completed --> disputed: post-complete dispute
  no_show --> dispatching: redispatch
  no_show --> cancelled: give up
  disputed --> resolved: case closed
  resolved --> closed: settle + close
```

**Money is not on this diagram.** `charge` / `refund` / `payout` rows join by `service_request_id`. A job can be `completed` and later `refunded` without changing status to “paid/refunded”.

### Actors on every transition

| Actor | Owns |
|-------|------|
| **member** | create request, see masked status, confirm completion, review, dispute |
| **agent** | score pool, fan-out offers, lock/release, propose arrival, parse field SMS, reminder scheduling, escalate — **only allow-listed APIs** |
| **contractor** | accept/decline offer, set/confirm arrival, otw/arrived/done, on-site exceptions |
| **ops** | exhaust-pool takeover, vetting, money auth, legal/medical/employment, ambiguous escalations |
| **system** | timers (offer TTL, reminders, review nudge), idempotent workers |

Every status change → `job_event` (audit + member timeline).

---

## 1. Flow A — Book → Dispatch

**Product intent:** Member books service type + address + window. Agent ranks vetted pool, fans out SMS offers (sequential TTL or small parallel first-accept-wins). Accept locks job; decline/timeout releases; pool exhaust → ops.

### A1. Intake (stub member app → `/v1`)

| Step | Who | API / artifact | Notes |
|------|-----|----------------|-------|
| A1.1 Create service request | member | `POST /v1/requests` | category, property, preferred window, details |
| A1.2 Land in pool | system | status `dispatching` | `job_event`; promise_by SLA clock starts |
| A1.3 INV-2 mask | API | member GET never exposes contractor | even while offers are out |

**Trackable acceptance:** request appears in ops Pool; member view shows “finding a pro” only.

### A2. Candidate scoring (agent, low-risk)

Score **vetted-only** contractors on:

1. **Skill match** — category ∩ contractor.categories  
2. **Distance / service zip** — property.zip ∈ service_zips (later: travel time)  
3. **Current load** — open booked/confirmed/checked_in count in window  
4. **Historical accept rate** — accepts / offers (rolling)  
5. (Optional later) rating, metro capacity, membership priority  

Output: ranked candidate list + recommended offer strategy (`sequential` | `parallel_batch`).

**Agent fence:** scoring + creating offers = allow-listed. Changing vetting, suspending pros, touching money = 403 → ops.

### A3. Offer fan-out

| Mode | Behavior |
|------|----------|
| **Sequential** | Offer top-1; TTL (e.g. 5–10m); on decline/timeout → next |
| **Parallel batch** | Offer top-N (e.g. 3); **first accept wins**; others auto-withdraw |

Artifacts (tables — names fixed for code):

- `dispatch_offer` — request_id, contractor_id, rank, status (`pending|accepted|declined|expired|withdrawn`), expires_at, channel (`sms` stub)  
- `dispatch_attempt` / wave id — strategy, batch size, started_at  

SMS is a **notification adapter** stubbed in API (`NotificationPort.sendOffer`). No real Twilio required for phase-1; console can Accept/Decline as contractor stand-in.

### A4. Lock / release / escalate

| Event | Status / data | Who |
|-------|---------------|-----|
| Accept | → `booked`; lock appointment slot; withdraw other offers | contractor (or agent applying contractor reply) |
| Decline / TTL | release candidate; continue wave | system / contractor |
| Pool exhaust | flag `needs_ops_dispatch`; stay `dispatching` | system → **ops only** |

**SLOT_CONFLICT** on lock → fail offer, continue or escalate (never silent).

**Trackable acceptance:** console shows offers + wave state; accept → job leaves pool as `booked` with contractor + slot; second accept on same wave fails cleanly.

---

## 2. Flow B — Dispatch → Confirmed

**Product intent:** After accept, nail exact arrival (not just window), notify member in-app, set reminder cadence T-24h / T-2h / T-30m.

### B1. Arrival solidification

| Step | Who | Notes |
|------|-----|-------|
| B1.1 Propose exact arrival within window | agent or contractor | e.g. slot 10:00–10:30 inside preferred window |
| B1.2 Contractor confirms arrival | contractor | required before `confirmed` |
| B1.3 Persist appointment | API | `appointments.slot_start/end` authoritative |

### B2. Member confirmation (blind)

| Step | Who | Notes |
|------|-----|-------|
| B2.1 Transition → `confirmed` | agent/ops/system | only after arrival locked |
| B2.2 Member notification | system | “Visit confirmed for {time}” — **no real name/photo of pro** if INV-2 still applies post-confirm per policy; use masked label (“Strech Pro”, confirmation code) |
| B2.3 confirmation_code | API | already on request; surface everywhere |

### B3. Reminder cadence

| Reminder | Audience | Channel stub |
|----------|----------|--------------|
| T-24h | member + contractor | push/SMS port |
| T-2h | member + contractor | |
| T-30m | member + contractor | |

Store `reminder_job` rows (request_id, fire_at, kind, status). System worker fires them; each fire → `job_event` note (timeline visibility).

**Trackable acceptance:** booked job can set exact slot → confirmed; reminder rows visible in console; member-facing payload has zero contractor PII leakage in tests.

---

## 3. Flow C — Confirmed → Job Complete

**Product intent:** Contractor signals otw / arrived / done (SMS or state prompt). Agent parses → timestamps → member progress. Handle messy on-site paths.

### C1. Happy path field signals

Map colloquial SMS → canonical transitions (API enforces; parser is adapter):

| Signal | Canonical | Status |
|--------|-----------|--------|
| `otw` / on my way | `en_route` event (optional substate) | stay `confirmed` + event, **or** soft flag |
| `arrived` | check-in | → `checked_in` |
| `done` | complete | → `completed` |

Prefer **explicit API actions** (`POST .../en-route`, `/check-in`, `/complete`) with SMS parser calling those. Do not let free-text alone mutate status without going through the same validators.

### C2. Member progress view (stub)

Member sees timeline from `job_event`s, masked:

- Pro confirmed  
- On the way  
- Arrived  
- Work completed  

### C3. Messy paths (first-class — not afterthoughts)

| Situation | Detection | System behavior | Escalate? |
|-----------|-----------|-----------------|-----------|
| **Running late** | contractor `late` + new ETA | event + member notify; update ETA | agent ok if ETA within policy; else ops |
| **Can't find place** | contractor flag | event; share access notes (non-medical); optional call ops | ops if access/safety |
| **Scope changed on site** | contractor `scope_change` | **do not auto-approve money**; open change-request / case | **ops** for price; agent may log only |
| **Member not home** | contractor / no-show member | → `no_show` (party=homeowner) or wait policy | agent can mark no-show if allow-listed; payout rules ops |
| **Needs a part** | `parts_hold` | stay `checked_in` (or substatus via events); schedule return visit | return visit = new request or linked follow-up |
| **Needs reschedule** | either party | unassign slot → reschedule path; may return toward `booked`/`dispatching` | agent propose; ops if dispute |
| **Contractor no-show** | timer past slot + no check-in | → `no_show` (party=contractor) → redispatch | ops if repeat offender |
| **Safety / medical / sensor alert** | Home Health Score signal | **never agent** — emergency path + ops | **hard fence** |

**Substatus pattern:** keep `ServiceRequest.status` coarse; put nuance in `job_event` + optional `job_flags` (`late`, `parts_hold`, `scope_change`) so money/status stay clean.

**Trackable acceptance:** each messy path has an API action + console button + event; agent cannot authorize scope price changes; medical path returns 403 for agent.

---

## 4. Flow D — Complete → Paid

**Product intent:** Dual confirmation, capture member card, calculate contractor payout, close job, ask for review.

### D1. Dual completion confirmation

| Step | Who | Artifact |
|------|-----|----------|
| D1.1 Contractor complete | contractor | status `completed` + summary |
| D1.2 Member confirms work OK | member | event `member_completion_ack` → `needs_review` or stay completed pending policy |
| D1.3 Dispute instead | member/ops | → `disputed` (not a refund status) |

### D2. Money (separate ledger)

| Row | Meaning |
|-----|---------|
| `charge` | what member owes (tier may make `amount_cents = 0`) |
| `payment_attempt` | card capture stub (processor port) |
| `payout` | contractor earnings calculation |
| `refund` | if case requires — **does not** set status=refunded |

Rules:

- Completion can exist before successful capture (visible failure, retry).  
- Payout calculation is deterministic from category + tier + change-orders **approved by ops**.  
- Agent **cannot** capture card, issue refund, or adjust payout — 403.

### D3. Review → close

| Step | Status |
|------|--------|
| Request review | `needs_review` + notify |
| Member submits review | `reviewed` |
| Review timeout policy | system auto-`reviewed` or ops nudge |
| Settle + close | `closed` when charge settled (or $0) and no open dispute |

**Trackable acceptance:** completed job shows charge+payout rows in console; refund can be added while status stays completed/closed; review request visible; close blocked if open dispute.

---

## 5. Agent fence (API allow-list sketch)

**Allow (low-risk):**

- Read pool, score candidates, create/cancel offers  
- Apply accept/decline from contractor channel  
- Propose arrival time; trigger confirm when prerequisites met  
- Schedule reminders  
- Parse field signals into en-route / check-in / complete **when state machine allows**  
- Flag late / can’t-find / parts_hold (logging)  
- Escalate to ops queue  

**Deny (403 → human):**

- Vetting approve/suspend, employment decisions  
- Money: capture, refund, payout override, tip disputes  
- Scope/price change approval  
- Legal / damage / injury cases  
- Home Health Score / medical / emergency  
- Blind-booking bypass (any member payload with real contractor identity)  
- Anything ambiguous → deny/escalate  

---

## 6. Console surfaces (thin, trackable)

| Console view | Shows |
|--------------|-------|
| **Pool** | `dispatching` + promise_by + active wave |
| **Offer radar** (new) | pending offers, TTLs, accepts/declines |
| **Board** | columns by status |
| **Request desk** | events timeline, flags, actions, money panel |
| **Reminders** | upcoming T-24/T-2/T-30 |
| **Cases** | disputed / no_show / scope_change needing ops |
| **Field** | contractor jobs + otw/arrived/done buttons (SMS stand-in) |
| **Contractors** | vetting, availability |

---

## 7. Work packages (build order — trackable)

Use these as tickets. Each has a crisp acceptance. Prefer API-first; console follows same package.

### WP0 — Foundations
- [ ] Schema spine: requests, properties, contractors (vetted), appointments, job_events  
- [ ] Actor JWT roles + edge bearer  
- [ ] Status transition engine (central) — illegal transitions 409  
- [ ] Every transition writes `job_event`  
- [ ] INV-2 member serializer tests  

### WP1 — Book → pool
- [ ] `POST /requests` → `dispatching`  
- [ ] Pool list for ops/agent  
- [ ] Console Pool  

### WP2 — Scoring + offers
- [ ] Ranked candidates endpoint (skill, zip, load, accept rate)  
- [ ] `dispatch_offer` + sequential + parallel_batch strategies  
- [ ] Offer TTL worker  
- [ ] Accept → `booked` + slot lock; withdraw siblings  
- [ ] Pool exhaust → ops escalation queue  
- [ ] Console Offer radar + accept/decline stand-in  

### WP3 — Confirm + reminders
- [ ] Exact arrival set + → `confirmed`  
- [ ] Masked member confirmation stub  
- [ ] Reminder rows + worker (T-24/T-2/T-30)  
- [ ] Console reminders on request desk  

### WP4 — Field loop
- [ ] en-route / check-in / complete APIs  
- [ ] Field console buttons  
- [ ] SMS parser adapter stub → same APIs  
- [ ] Member timeline projection from events  

### WP5 — Messy paths
- [ ] late + ETA  
- [ ] cant_find  
- [ ] scope_change → ops case (no auto money)  
- [ ] member/contractor no_show + redispatch  
- [ ] parts_hold + follow-up link  
- [ ] reschedule / reassign  
- [ ] agent 403 tests on medical + money + scope approve  

### WP6 — Money + review + close
- [ ] charge / payout / refund tables (no status pollution)  
- [ ] payment capture stub + failure retry  
- [ ] dual confirm + needs_review → reviewed  
- [ ] close guards (dispute open? unsettled charge?)  
- [ ] Console money + case panels  

### WP7 — Hardening
- [ ] Idempotency keys on all writes  
- [ ] SLOT_CONFLICT correctness  
- [ ] Audit export of job_events  
- [ ] Smoke: full happy path + one messy path + one money path  

---

## 8. Mapping your four flows → WPs

| Product flow | Primary WPs | Happy path statuses |
|--------------|-------------|---------------------|
| Book → Dispatch | WP1, WP2 | → `dispatching` → `booked` |
| Dispatch → Confirmed | WP3 | → `confirmed` |
| Confirmed → Job Complete | WP4, WP5 | → `checked_in` → `completed` |
| Complete → Paid | WP6 | money rows + → `needs_review` → `reviewed` → `closed` |

---

## 9. Explicit non-goals (this phase)

- Real Twilio/Stripe (ports + stubs only)  
- Member consumer app / Bobo 3D UI  
- Full geo routing ML  
- Production IdP  

Stub the ports; keep the state machine and audit trail real.

---

## 10. Suggested next step

Implement **WP0 → WP1 → WP2** until Offer radar can lock a job from the pool in the console. That is the first vertical slice of Flow A and unblocks everything else.

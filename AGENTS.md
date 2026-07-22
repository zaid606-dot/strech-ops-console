# Strech dispatch — what you're building

Read this before writing code. This is the domain and the rules — the *why* and the *what*. The *how* (build order, tasks, per-task acceptance) lives in `cursor-dispatch-brief.md`.

---

## What Strech is

Strech is a home-health membership company. It puts IoT sensors in members' homes, computes a **Home Health Score** from them, and runs a network of **vetted contractors** for in-home services (HVAC, landscaping, appliance repair and replacement). A large share of members are older adults living independently. The entire product rests on **trust** — hardware and a stranger inside someone's home — so the software's job is to make that safe, on-time, and accountable. You are building the part that dispatches the contractors.

## Scope — you are building the dispatch backend, not the app

The deliverable is the **backend that dispatches service contractors**, plus a **thin console to look at it and drive it** — nothing more.

- **In scope:** `strech-dispatch-api` (the backend, source of truth, `/v1`, Postgres) and `strech-ops-console` **only as the window into that backend** — enough UI to watch jobs move through the loop, assign a pro, and see a dispatch happen. API-first: the console is an inspection/operations surface, not a product.
- **Out of scope — do not build:** the member-facing consumer app, the 3D-home booking experience (`strech-3d-home-spike`, Bobo's), the membership/marketing product, billing UX, mobile. If a task seems to need one, stub it behind the `/v1` contract and stop.
- **"Done" test:** someone opens the console and watches a contractor get dispatched end-to-end against real data — pool → assign → confirm → check-in → complete → close. If the backend supports that and the console shows it, this phase is done.

Don't gold-plate the console into an app; don't go headless with no way to see the loop either. "A backend one can look at" = API-first, with just enough surface to observe and exercise it.

## The thing you're building — one job, start to finish

A member asks for a service visit **without picking a contractor** (this is deliberate — see "blind booking"). The request lands in a **dispatch pool**. Ops matches it to a **vetted** contractor and locks a **time slot**. The contractor **checks in** on site and marks the job **complete**. The member can **review**; ops **closes** it. When something goes wrong — no-show, bad work, a refund, damage — the job goes through a **case/resolution** path instead of straight to close.

Everything real (jobs, contractors, appointments, charges, events) lives in **Postgres behind the dispatch API**. The UIs are dumb clients — they never touch the database, they call `/v1`.

## Who's in the system (roles on the actor JWT)

- **member / homeowner** — requests visits, sees status, reviews. Never sees which contractor is coming before confirmation.
- **ops** — the dispatch desk. Assigns pros, handles cases, authorizes money.
- **contractor** — the field pro. Sees their assigned jobs, checks in, completes.
- **system** — automated jobs (timers, seeds).
- **agent** — an AI operator (new). Runs the loop autonomously but is fenced to low-risk actions by the API, not by instructions.

## Vocabulary — use these exact names in code, don't invent synonyms

- **Dispatch pool** — jobs in `dispatching`, waiting for a contractor.
- **Blind booking / INV-2** — the member does not see the contractor's identity before (and per policy, after) confirmation. The masked-pro rule. Leaking the real contractor to the member is a bug, not a feature.
- **Vetted contractor** — a contractor past `vetting_status` approval. Only vetted pros are assignable.
- **Home Health Score** — the member-facing score computed from sensor data. Not part of dispatch, but a medical/safety signal from it must never be handled by the dispatch agent (see invariants).
- **Membership tiers** — Free, Comfort, Premium. They change *what a visit costs*, not the dispatch plumbing. An included visit is still a `charge` row at `amount_cents = 0`.
- **BFF** — the Next.js API routes in `ops-console` that proxy the browser to `/v1`. Auth: `Authorization: Bearer <edge secret>` + `X-Strech-Actor: <JWT>`.
- **Statuses** — `dispatching → booked → confirmed → checked_in → completed → needs_review → reviewed → closed`, plus `no_show`, `cancelled`, and (new) `disputed → resolved`.

## Architecture in one breath

Three apps exist, but **your build is the first two**. **`strech-dispatch-api`** is the source of truth (Neon Postgres, `/v1`); **`strech-ops-console`** is the ops/field console — your window into the backend (Next.js, BFF + UI). **`strech-3d-home-spike`** (Bobo's member 3D-home booking surface) is **out of scope** — listed only so you know where member bookings originate. All writes go through `/v1`. Every actor is identified by the `X-Strech-Actor` JWT `role`.

## Invariants — these encode the business. Never break them.

1. **Blind booking holds.** The contractor's identity is masked to the member per the INV-2 rule. Any endpoint or view that returns member-facing data must not expose the real contractor before/against policy.
2. **Money is not a job status.** A visit can be `completed` *and* `refunded` at the same time. Charges, refunds, and payouts are their own tables joined by `service_request_id`. Never add `refunded`/`paid` to `ServiceRequest.status`.
3. **Escalation is enforced in code, keyed on role — not in a prompt.** This software operates inside people's homes. Anything physical, medical, legal, or employment-related is human-only, and a Home Health Score / sensor medical signal **never** routes through the dispatch agent — it goes straight to the emergency path. The `agent` role is allow-listed to low-risk actions at the API; everything else returns 403. When the tier is ambiguous, deny/escalate.
4. **Every status change writes a `job_event`.** That event log is the audit trail *and* the customer timeline — it's how a dispute gets litigated and how ops sees what the member saw. Treat it as load-bearing.
5. **The DB behind `/v1` is the only source of truth.** UIs never talk to the database. Business rules live in the API, not the client.

## What "good" means here

Trust-critical and auditable beats fast. Safe-by-default: when unsure, escalate or deny, never guess-and-act. This is operations software that moves real money and sends real people into real homes — closer to a payments system than a growth-hacky consumer app. Optimize for *no silent failures* and *nothing crosses a safety line*, not for shipping the most features per week.

## Greenfield note

This phase starts fresh. Prefer rebuilding against the domain and `cursor-dispatch-brief.md` over extending legacy Gate assumptions. Bobo / 3D-home is out of scope — stub behind `/v1` and stop.

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
| **1** | Locked desk shell | ✅ in progress / shipped — password login, hard route lock, Overview, Vercel-ready |
| **2** | Dispatch API spine | `/v1` health, schema, status engine, `job_event` — API runs locally/hosted |
| **3** | Book → Pool | Seed/create request → appears in Pool (live data) |
| **4** | Offers → Booked | Scoring, offer waves, Accept/Decline, Offer radar, Board |
| **5** | Confirm + reminders + charge | `ack_arrival`, `confirm_visit`, pending charge, reminders on desk |
| **6** | Agent runtime | Work queue, policy toggles, tick worker, Agent panel |
| **7** | Field loop | Check-in / complete, timeline progress |
| **8** | Cases + messy paths | Cases UI, no-show/parts/scope, emergency ingress |
| **9** | Money + review + close | Capture stub, payout held→payable, review → close |
| **10** | Harden + prod smoke | Idempotency, INV-2 tests, full loop on Vercel link |

## Stage 1 acceptance

- [ ] Login requires **username + password** from env (not a shared “dev token” field)
- [ ] Unauthenticated users cannot reach `/ops/*` or `/api/ops/*`
- [ ] Failed auth does not leak whether user or password was wrong
- [ ] Overview loads after login; nav matches watch-desk IA
- [ ] `npm run build` succeeds (Vercel-ready)
- [ ] `.env.example` documents Vercel env vars

## Core directives (every stage)

Blind booking · money ≠ status · agent fence in API · every status → `job_event` · `/v1` source of truth · trust > speed

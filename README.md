# Strech Ops Console

Password-gated dispatch desk. API-first window onto `strech-dispatch-api`.

**Build stages:** [`STAGES.md`](./STAGES.md) (1–10). Domain: [`AGENTS.md`](./AGENTS.md). Brief: [`cursor-dispatch-brief.md`](./cursor-dispatch-brief.md).

## Quick start (local)

```bash
# API + Postgres
cd dispatch-api && cp .env.example .env && npm install
npm run migrate && npm run smoke:full && npm run dev   # :3001

# Console (separate terminal)
cd .. && cp .env.example .env.local
# Set OPS_DASHBOARD_USER, OPS_DASHBOARD_PASSWORD (≥12), OPS_OPERATOR_SUB (UUID)
# STRECH_DISPATCH_BASE_URL=http://localhost:3001/v1
# STRECH_EDGE_BEARER_TOKEN + STRECH_ACTOR_JWT_SECRET (match API .env)
npm install && npm run dev   # :3002 → /login
```

### Desk loop (UI smoke)

1. Log in → Book a real visit → Pool  
2. Contractors: create → approve → add slot  
3. Request desk: Start offer wave → Pending offers Accept (desk) — or Book directly  
4. Desk: Ack arrival → Confirm visit  
5. Field (`/field/login` with contractor UUID from Contractors): On my way → Check in → Complete  
6. Desk: Submit review → Close; Cases / Agent / Money for messy paths  

### API smokes

```bash
cd dispatch-api
npm test
npm run smoke:all    # spine → … → full (happy + emergency + CONTRACTOR_UNFIT + idempotency)
npm run smoke:full   # single end-to-end closed + audit export
```

## Vercel (console) + hosted API

### 1. Deploy API

Host `dispatch-api/` on Fly / Railway / Render with Neon (or any Postgres):

```bash
cd dispatch-api
# set DATABASE_URL, EDGE_BEARER_TOKEN, ACTOR_JWT_SECRET
npm run migrate
npm start   # PORT from host
```

Health: `GET /api/ready`, `GET /v1/health` (with edge + actor JWT).

### 2. Deploy console on Vercel

1. Import repo → Framework **Next.js** (root)  
2. Env (Production + Preview):

| Var | Required |
|-----|----------|
| `OPS_DASHBOARD_USER` | yes |
| `OPS_DASHBOARD_PASSWORD` | yes (≥12) |
| `OPS_SESSION_SECRET` | recommended (≥12) |
| `OPS_OPERATOR_SUB` | yes (UUID) |
| `FIELD_DASHBOARD_PASSWORD` | optional |
| `STRECH_DISPATCH_BASE_URL` | yes (`https://<api-host>/v1`) |
| `STRECH_EDGE_BEARER_TOKEN` | yes (match API) |
| `STRECH_ACTOR_JWT_SECRET` | yes (match API) |

3. Deploy → `https://<project>.vercel.app/login`  
4. Optional: Vercel Deployment Protection as a second lock (app password still required)

### 3. Prod smoke checklist

On the Vercel URL against the hosted API:

- [ ] Login with ops user/password  
- [ ] Seed → offers → accept → confirm  
- [ ] Field complete → review → **closed**  
- [ ] Member-view / progress stays INV-2 masked (no contractor identity)  
- [ ] Emergency case sorts first on Cases; agent cannot approve scope / capture  
- [ ] Double-submit of a write with same `Idempotency-Key` returns `Idempotent-Replay: true`  

Desk routes (`/ops/*`, `/api/ops/*`) refuse traffic without a session cookie.

## Stage map

| Stage | Status |
|-------|--------|
| 1 Locked desk shell | ✅ |
| 2 API spine | ✅ |
| 3 Book → Pool | ✅ |
| 4 Offers → Booked | ✅ |
| 5 Confirm + charge/reminders | ✅ |
| 6 Agent runtime | ✅ |
| 7 Field loop | ✅ |
| 8 Cases + messy paths | ✅ |
| 9 Money + review + close | ✅ |
| 10 Harden + prod smoke | ✅ |

## Field

`/field/login` — contractor UUID + field password.

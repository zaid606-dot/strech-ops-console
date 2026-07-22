# Strech Ops Console

Password-gated dispatch desk. API-first window onto `strech-dispatch-api`.

**Build stages:** see [`STAGES.md`](./STAGES.md). Domain: [`AGENTS.md`](./AGENTS.md).

## Stage 1 — locked shell

```bash
cp .env.example .env.local
# Set OPS_DASHBOARD_USER + OPS_DASHBOARD_PASSWORD (≥12 chars)
npm install
npm run dev   # http://localhost:3002/login
```

### Vercel

1. Import this repo → Framework Preset **Next.js**
2. Set env (Production + Preview):

| Var | Required |
|-----|----------|
| `OPS_DASHBOARD_USER` | yes |
| `OPS_DASHBOARD_PASSWORD` | yes (≥12 chars) |
| `OPS_SESSION_SECRET` | recommended (≥12; defaults to ops password) |
| `OPS_OPERATOR_SUB` | yes (UUID) |
| `FIELD_DASHBOARD_PASSWORD` | optional (falls back to ops password) |
| `STRECH_DISPATCH_BASE_URL` | Stage 2+ |
| `STRECH_EDGE_BEARER_TOKEN` | Stage 2+ |
| `STRECH_ACTOR_JWT_SECRET` | Stage 2+ |

3. Deploy. Open `https://<project>.vercel.app/login`
4. Optional: enable Vercel Deployment Protection as a second lock; app password is still required

Desk routes (`/ops/*`, `/api/ops/*`) refuse traffic without a session cookie. Auth failures return a generic error (no user/password distinction).

## Field

`/field/login` — contractor UUID + field password.

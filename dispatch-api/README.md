# Strech Dispatch API (Stage 2 spine)

Source of truth for Strech contractor dispatch. Ops console talks only to `/v1`.

## Quick start

```bash
cd dispatch-api
cp .env.example .env
# DATABASE_URL=postgresql://strech:strech@127.0.0.1:5432/strech_dispatch
npm install
npm run migrate
npm run test
npm run smoke:spine
npm run dev   # :3001
```

## Endpoints (Stage 2)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/ready` | DB ping (no auth) |
| GET | `/v1/health` | Edge + actor JWT |
| GET | `/v1/meta/statuses` | Canonical status enum |
| GET | `/v1/pool` | `dispatching` jobs (ops/agent) |
| GET | `/v1/requests/:id/member-view` | INV-2 masked projection |

Auth: `Authorization: Bearer <EDGE_BEARER_TOKEN>` + `X-Strech-Actor: <JWT role+sub>`.

## Hosting

Run as a Node service (Fly/Railway/Render) with Neon `DATABASE_URL`.  
Ops console on Vercel points `STRECH_DISPATCH_BASE_URL` at this service’s `/v1`.

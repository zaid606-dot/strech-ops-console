# Strech Dispatch API

Source of truth for Strech contractor dispatch (Stages 2–10). Ops console talks only to `/v1`.

## Quick start

```bash
cd dispatch-api
cp .env.example .env
# DATABASE_URL=postgresql://strech:strech@127.0.0.1:5432/strech_dispatch
npm install
npm run migrate
npm test
npm run smoke:full
npm run dev   # :3001
```

Auth: `Authorization: Bearer <EDGE_BEARER_TOKEN>` + `X-Strech-Actor: <JWT role+sub>`.  
Writes accept optional `Idempotency-Key` (replay returns `Idempotent-Replay: true`).

## Smokes

```bash
npm run smoke:all    # all stage smokes
npm run smoke:full   # happy → closed + emergency + CONTRACTOR_UNFIT + idempotency
```

## Notable surfaces

| Area | Paths |
|------|--------|
| Pool / offers | `/v1/pool`, `/v1/offers`, `/offer-wave`, `/accept` |
| Desk book | `POST /v1/appointments` (ops direct-book) |
| Confirm | `/ack-arrival`, `/confirm-visit`, charges, reminders |
| Agent | `/v1/agent/work`, `/tick`, `/policy` |
| Field | `/contractors/me/jobs`, `/en-route`, `/check-in`, `/complete`, `/field/sms-inbound` |
| Cases | `/v1/cases`, `/emergency`, messy recovery |
| Money | `/money`, `/capture`, `/review`, `/close`, `/refund` |
| Audit | `/v1/ops/audit/events` |

## Hosting

Node service (Fly/Railway/Render) + Neon `DATABASE_URL`.  
Vercel console points `STRECH_DISPATCH_BASE_URL` at this host’s `/v1` (secrets must match).

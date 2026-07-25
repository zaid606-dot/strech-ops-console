# Contractor ↔ dispatch backend connect

This console is the contractor desk + field portal. It never talks to Postgres — only to dispatch `/v1`.

## Env (must match dispatch)

| Ops console | Dispatch |
|-------------|----------|
| `STRECH_DISPATCH_BASE_URL` | `https://…/v1` (or `http://localhost:3001/v1`) |
| `STRECH_EDGE_BEARER_TOKEN` | `EDGE_BEARER_TOKEN` |
| `STRECH_ACTOR_JWT_SECRET` | `ACTOR_JWT_SECRET` |
| `OPS_OPERATOR_SUB` | UUID (not a string like `ops-local-1`) |
| `OPS_DEV_TOKEN` / `FIELD_DEV_TOKEN` | console-only |

Dispatch DB: migrate through **`008`** (`contractor_applications`, capacity, metros).

## Connect checklist

1. Dispatch up + `GET /api/ready` → 200  
2. Copy secrets into ops `.env.local`  
3. From **dispatch-api**:  
   `DISPATCH_BASE_URL=<same host>/v1 npm run seed:ops-contractor`  
   → note printed `contractor_id`  
4. Ops: `npm run dev` → http://localhost:3002  
5. Login → **Contractors** → Approve if needed, add availability  
6. Pool → book → confirm  
7. **Field** → login with contractor UUID + field token → check-in → complete  

Verify from dispatch-api:

```bash
npm run smoke:gate3
npm run smoke:gate4
```

## BFF paths (contractor)

| Console | Dispatch |
|---------|----------|
| `GET/POST /api/ops/contractors` | `/contractors` |
| `POST /api/ops/contractors/[id]/vetting` | `/contractors/{id}/vetting` |
| `GET/POST /api/ops/contractors/[id]/availability` | `/contractors/{id}/availability` |
| `GET /api/ops/contractors/available` | `/contractors/available` |
| `GET /api/field/jobs` | `/contractors/me/jobs` |
| `POST /api/field/jobs/[id]/check-in` | `/requests/{id}/check-in` |
| `POST /api/field/jobs/[id]/complete` | `/requests/{id}/complete` |

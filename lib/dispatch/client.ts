import { mintContractorActorJwt, mintOpsActorJwt } from '@/lib/dispatch/actorJwt';
import { assertDispatchConfigured } from '@/lib/dispatch/config';

export class DispatchHttpError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Dispatch HTTP ${status}`);
  }
}

type DispatchFetchOpts = {
  method: string;
  path: string;
  body?: unknown;
  idempotencyKey?: string;
  query?: Record<string, string | undefined>;
} & (
  | { role: 'ops'; operatorSub: string }
  | { role: 'contractor'; contractorId: string }
);

/** Authenticated call to dispatch /v1 as ops or contractor. */
export async function dispatchFetch<T = unknown>(opts: DispatchFetchOpts): Promise<T> {
  const { baseUrl, edgeBearer } = assertDispatchConfigured();
  const actorJwt =
    opts.role === 'ops'
      ? await mintOpsActorJwt(opts.operatorSub)
      : await mintContractorActorJwt(opts.contractorId);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${edgeBearer}`,
    'X-Strech-Actor': actorJwt,
    Accept: 'application/json',
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const qs = new URLSearchParams();
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') qs.set(k, v);
    }
  }
  const q = qs.toString();
  const url = `${baseUrl}${opts.path}${q ? `?${q}` : ''}`;

  const res = await fetch(url, {
    method: opts.method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }

  if (!res.ok) throw new DispatchHttpError(res.status, parsed);
  return parsed as T;
}

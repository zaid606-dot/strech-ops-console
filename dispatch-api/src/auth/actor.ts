import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';

export type Actor = {
  role: 'member' | 'ops' | 'contractor' | 'system' | 'agent';
  sub: string;
};

export type Env = {
  Variables: {
    actor: Actor;
  };
};

function edgeToken(): string {
  return process.env.EDGE_BEARER_TOKEN ?? '';
}

function actorSecret(): Uint8Array {
  const s = process.env.ACTOR_JWT_SECRET ?? '';
  if (!s) throw new Error('ACTOR_JWT_SECRET missing');
  return new TextEncoder().encode(s);
}

const ROLES = new Set(['member', 'ops', 'contractor', 'system', 'agent']);

/** Paths the agent role may call (method + pathname without query). */
const AGENT_ALLOW = new Set<string>([
  'GET /v1/health',
  'GET /v1/meta/statuses',
  'GET /v1/pool',
]);

export function assertAgentAllowed(method: string, path: string, role: Actor['role']) {
  if (role !== 'agent') return;
  const key = `${method.toUpperCase()} ${path}`;
  if (AGENT_ALLOW.has(key)) return;
  const err = new Error('AGENT_FORBIDDEN') as Error & { status: number; code: string };
  err.status = 403;
  err.code = 'AGENT_FORBIDDEN';
  throw err;
}

/** Require Authorization: Bearer <edge> + X-Strech-Actor JWT. */
export const requireActor = createMiddleware<Env>(async (c, next) => {
  const auth = c.req.header('authorization') ?? '';
  const expected = edgeToken();
  if (!expected || auth !== `Bearer ${expected}`) {
    return c.json({ error: 'unauthorized', detail: 'invalid edge bearer' }, 401);
  }

  const actorJwt = c.req.header('x-strech-actor');
  if (!actorJwt) {
    return c.json({ error: 'unauthorized', detail: 'missing X-Strech-Actor' }, 401);
  }

  try {
    const { payload } = await jwtVerify(actorJwt, actorSecret(), {
      algorithms: ['HS256'],
    });
    const role = payload.role;
    const sub = payload.sub;
    if (typeof role !== 'string' || !ROLES.has(role)) {
      return c.json({ error: 'unauthorized', detail: 'invalid actor role' }, 401);
    }
    if (typeof sub !== 'string' || !sub) {
      return c.json({ error: 'unauthorized', detail: 'invalid actor sub' }, 401);
    }
    c.set('actor', { role: role as Actor['role'], sub });
  } catch {
    return c.json({ error: 'unauthorized', detail: 'invalid actor jwt' }, 401);
  }

  try {
    // c.req.path is under the mounted /v1 app — rebuild full path
    const fullPath = `/v1${c.req.path === '/' ? '' : c.req.path}`;
    assertAgentAllowed(c.req.method, fullPath, c.get('actor').role);
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    if (err.status === 403) {
      return c.json({ error: 'forbidden', code: err.code ?? 'AGENT_FORBIDDEN' }, 403);
    }
    throw e;
  }

  await next();
});

/** Dispatch BFF config — server-only. Never import from client components. */
export function dispatchConfig() {
  const baseUrl = (process.env.STRECH_DISPATCH_BASE_URL ?? '').replace(/\/$/, '');
  const edgeBearer = process.env.STRECH_EDGE_BEARER_TOKEN ?? '';
  const actorSecret = process.env.STRECH_ACTOR_JWT_SECRET ?? '';
  const enabled = Boolean(baseUrl && edgeBearer && actorSecret);
  return { baseUrl, edgeBearer, actorSecret, enabled };
}

export function assertDispatchConfigured(): {
  baseUrl: string;
  edgeBearer: string;
  actorSecret: string;
} {
  const cfg = dispatchConfig();
  if (!cfg.baseUrl || !cfg.edgeBearer || !cfg.actorSecret) {
    throw new Error(
      'Dispatch not configured. Set STRECH_DISPATCH_BASE_URL, STRECH_EDGE_BEARER_TOKEN, STRECH_ACTOR_JWT_SECRET',
    );
  }
  return {
    baseUrl: cfg.baseUrl,
    edgeBearer: cfg.edgeBearer,
    actorSecret: cfg.actorSecret,
  };
}

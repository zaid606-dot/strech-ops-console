/** Safe post-login path: only /ops or /ops/... */
export function safeOpsNextPath(next: string | null | undefined): string {
  if (!next || typeof next !== 'string') return '/ops';
  if (next.includes('..') || next.includes('\\') || next.includes('//')) return '/ops';
  if (next === '/ops' || next.startsWith('/ops/')) return next;
  return '/ops';
}

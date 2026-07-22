import { SignJWT } from 'jose';

import { assertDispatchConfigured } from '@/lib/dispatch/config';

async function mint(role: 'ops' | 'contractor', sub: string): Promise<string> {
  const { actorSecret } = assertDispatchConfigured();
  const key = new TextEncoder().encode(actorSecret);
  return new SignJWT({ role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(key);
}

/** Mint X-Strech-Actor JWT for dispatch (ops role). */
export async function mintOpsActorJwt(operatorSub: string): Promise<string> {
  return mint('ops', operatorSub);
}

/** Mint X-Strech-Actor JWT for dispatch (contractor role; sub = contractor_id). */
export async function mintContractorActorJwt(contractorId: string): Promise<string> {
  return mint('contractor', contractorId);
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canTransition,
  IllegalTransitionError,
  isStatus,
  transitionStatus,
} from './transitions.js';

function mockClient(initialStatus: string) {
  let status = initialStatus;
  let inTxn = true;
  const events: unknown[] = [];
  const client = {
    events,
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('txid_current_if_assigned')) {
        return { rows: [{ txid: inTxn ? '1' : null }], rowCount: 1 };
      }
      if (sql.includes('FOR UPDATE')) {
        return { rows: [{ status }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE')) {
        if (params && params.length >= 2) status = String(params[1]);
        else if (sql.includes("'completed'")) status = 'completed';
        else if (sql.includes("'needs_review'")) status = 'needs_review';
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO job_events')) {
        events.push({
          from: params?.[1],
          to: params?.[2],
          role: params?.[3],
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { client, getStatus: () => status };
}

describe('status machine', () => {
  it('allows happy-path edges', () => {
    assert.equal(canTransition('dispatching', 'booked'), true);
    assert.equal(canTransition('booked', 'confirmed'), true);
    assert.equal(canTransition('confirmed', 'checked_in'), true);
    assert.equal(canTransition('checked_in', 'completed'), true);
    assert.equal(canTransition('needs_review', 'reviewed'), true);
    assert.equal(canTransition('reviewed', 'closed'), true);
  });

  it('rejects legacy synonym statuses', () => {
    assert.equal(isStatus('scheduled'), false);
    assert.equal(isStatus('assigned'), false);
    assert.equal(isStatus('in_progress'), false);
    assert.equal(isStatus('paid'), false);
    assert.equal(isStatus('refunded'), false);
  });

  it('rejects illegal jumps', () => {
    assert.equal(canTransition('dispatching', 'closed'), false);
    assert.equal(canTransition('confirmed', 'completed'), false);
    assert.equal(canTransition('closed', 'dispatching'), false);
  });

  it('requires an open transaction', async () => {
    const { client } = mockClient('dispatching');
    // force no txn
    client.query = async (sql: string) => {
      if (sql.includes('txid_current_if_assigned')) {
        return { rows: [{ txid: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    await assert.rejects(
      () =>
        transitionStatus(client, {
          serviceRequestId: '00000000-0000-4000-8000-000000000001',
          to: 'booked',
          actorRole: 'ops',
          actorId: '00000000-0000-4000-8000-0000000000aa',
        }),
      /open DB transaction/,
    );
  });

  it('transitionStatus writes event and rejects illegal', async () => {
    const { client } = mockClient('dispatching');
    const ok = await transitionStatus(client, {
      serviceRequestId: '00000000-0000-4000-8000-000000000001',
      to: 'booked',
      actorRole: 'ops',
      actorId: '00000000-0000-4000-8000-0000000000aa',
      note: 'test',
    });
    assert.equal(ok.from, 'dispatching');
    assert.equal(ok.to, 'booked');
    assert.equal(client.events.length, 1);

    await assert.rejects(
      () =>
        transitionStatus(client, {
          serviceRequestId: '00000000-0000-4000-8000-000000000001',
          to: 'closed',
          actorRole: 'ops',
          actorId: '00000000-0000-4000-8000-0000000000aa',
        }),
      (err: unknown) => err instanceof IllegalTransitionError,
    );
  });

  it('complete auto-chains to needs_review with two events', async () => {
    const { client, getStatus } = mockClient('checked_in');
    const ok = await transitionStatus(client, {
      serviceRequestId: '00000000-0000-4000-8000-000000000001',
      to: 'completed',
      actorRole: 'contractor',
      actorId: '00000000-0000-4000-8000-0000000000cc',
      note: 'done',
    });
    assert.equal(ok.to, 'needs_review');
    assert.equal(getStatus(), 'needs_review');
    assert.equal(client.events.length, 2);
    assert.equal((client.events[0] as { to: string }).to, 'completed');
    assert.equal((client.events[1] as { to: string }).to, 'needs_review');
    assert.equal((client.events[1] as { role: string }).role, 'system');
  });
});

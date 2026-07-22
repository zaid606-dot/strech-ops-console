import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { computePromiseBy, slaHours } from './sla.js';

describe('SLA promise_by', () => {
  it('shortens for Premium vs Free', () => {
    assert.ok(slaHours('hvac', 'Premium') < slaHours('hvac', 'Free'));
    assert.equal(slaHours('hvac', 'Free'), 24);
    assert.equal(slaHours('hvac', 'Premium'), 12);
  });

  it('computes promise_by from created_at', () => {
    const created = new Date('2026-07-22T12:00:00.000Z');
    const promise = computePromiseBy(created, 'hvac', 'Free');
    assert.equal(promise.toISOString(), '2026-07-23T12:00:00.000Z');
  });
});

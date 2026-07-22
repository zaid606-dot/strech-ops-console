import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertNoContractorLeak, memberPublicRequest } from './member.js';
import { agentContextCase, contractorFieldPayload } from './tiers.js';

describe('INV-2 member serializer', () => {
  it('omits contractor identity when confirmed', () => {
    const view = memberPublicRequest({
      id: '00000000-0000-4000-8000-000000000099',
      status: 'confirmed',
      category_id: 'hvac',
      confirmation_code: 'CONF-1',
      preferred_window_start: null,
      preferred_window_end: null,
      confirmed_at: new Date().toISOString(),
      promise_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assigned_contractor_id: '00000000-0000-4000-8000-000000000077',
      appointment_id: '00000000-0000-4000-8000-000000000088',
    });
    assert.equal(view.pro_label, 'Strech Pro');
    assert.equal('assigned_contractor_id' in view, false);
    assert.equal('appointment_id' in view, false);
    assertNoContractorLeak(view);
  });

  it('hides pro_label while dispatching', () => {
    const view = memberPublicRequest({
      id: '00000000-0000-4000-8000-000000000099',
      status: 'dispatching',
      category_id: 'hvac',
      confirmation_code: 'CONF-2',
      preferred_window_start: null,
      preferred_window_end: null,
      confirmed_at: null,
      promise_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assigned_contractor_id: null,
    });
    assert.equal(view.pro_label, null);
    assertNoContractorLeak(view);
  });

  it('stays masked after needs_review', () => {
    const view = memberPublicRequest({
      id: '00000000-0000-4000-8000-000000000099',
      status: 'needs_review',
      category_id: 'hvac',
      confirmation_code: 'CONF-3',
      preferred_window_start: null,
      preferred_window_end: null,
      confirmed_at: new Date().toISOString(),
      promise_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      assigned_contractor_id: '00000000-0000-4000-8000-000000000077',
    });
    assert.equal(view.pro_label, 'Strech Pro');
    assertNoContractorLeak(view);
  });

  it('assertNoContractorLeak throws on contractor_id', () => {
    assert.throws(() => assertNoContractorLeak({ contractor_id: 'x' }), /INV2_LEAK/);
  });
});

describe('PII tiers', () => {
  it('contractor_field strips medical/safety/billing', () => {
    const view = contractorFieldPayload({
      id: 'r1',
      status: 'confirmed',
      category_id: 'hvac',
      confirmation_code: 'SR-1',
      address_line1: '1 Main',
      city: 'Austin',
      state: 'TX',
      zip: '78701',
      details: {
        gate_code: '1234',
        'medical.notes': 'secret',
        'safety.emergency': true,
        billing: { card: 'x' },
        pet: 'dog',
      },
    });
    assert.equal(view.details.pet, 'dog');
    assert.equal(view.details.gate_code, '1234');
    assert.equal('medical.notes' in view.details, false);
    assert.equal('safety.emergency' in view.details, false);
    assert.equal('billing' in view.details, false);
  });

  it('agent_context redacts emergency payload bodies', () => {
    const view = agentContextCase({
      id: 'c1',
      type: 'emergency',
      meta: { signal_type: 'fall', payload: { medical: 'hidden' } },
    });
    assert.equal((view.meta as { has_payload: boolean }).has_payload, true);
    assert.equal('payload' in (view.meta as object), false);
  });
});

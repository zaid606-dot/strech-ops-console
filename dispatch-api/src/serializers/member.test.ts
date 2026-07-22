import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertNoContractorLeak, memberPublicRequest } from './member.js';

describe('INV-2 member serializer', () => {
  it('omits contractor identity fields', () => {
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
});

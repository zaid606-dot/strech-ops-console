export type AgentPolicySettings = {
  offer: {
    strategy: 'sequential' | 'parallel_batch';
    batch_size: number;
    ttl_seconds: number;
    max_waves_before_ops: number;
  };
  confirm: {
    auto_confirm_visit: boolean;
    require_contractor_ack: boolean;
    max_eta_slip_minutes: number;
    reminder_cadence: string[];
  };
  field: {
    auto_apply_sms: boolean;
    ambiguous_sms: 'escalate';
  };
  sla: {
    promise_by_escalate_minutes: number;
  };
  stuck: {
    no_progress_minutes: number;
  };
};

export const DEFAULT_AGENT_POLICY: AgentPolicySettings = {
  offer: {
    strategy: 'parallel_batch',
    batch_size: 3,
    ttl_seconds: 600,
    max_waves_before_ops: 3,
  },
  confirm: {
    auto_confirm_visit: true,
    require_contractor_ack: true,
    max_eta_slip_minutes: 30,
    reminder_cadence: ['24h', '2h', '30m'],
  },
  field: {
    auto_apply_sms: true,
    ambiguous_sms: 'escalate',
  },
  sla: {
    promise_by_escalate_minutes: 30,
  },
  stuck: {
    no_progress_minutes: 45,
  },
};

/** Fixed agent worker subject — tick mutations always use this actor. */
export const AGENT_ACTOR_ID = '00000000-0000-4000-8000-0000000000ae';

export function mergePolicyPatch(
  current: AgentPolicySettings,
  patch: Partial<{
    offer: Partial<AgentPolicySettings['offer']>;
    confirm: Partial<AgentPolicySettings['confirm']>;
    field: Partial<AgentPolicySettings['field']>;
    sla: Partial<AgentPolicySettings['sla']>;
    stuck: Partial<AgentPolicySettings['stuck']>;
  }>,
): AgentPolicySettings {
  return {
    offer: { ...current.offer, ...(patch.offer ?? {}) },
    confirm: { ...current.confirm, ...(patch.confirm ?? {}) },
    field: { ...current.field, ...(patch.field ?? {}) },
    sla: { ...current.sla, ...(patch.sla ?? {}) },
    stuck: { ...current.stuck, ...(patch.stuck ?? {}) },
  };
}

export function normalizePolicy(raw: unknown): AgentPolicySettings {
  const r = (raw ?? {}) as Partial<AgentPolicySettings>;
  return mergePolicyPatch(DEFAULT_AGENT_POLICY, {
    offer: r.offer,
    confirm: r.confirm,
    field: r.field,
    sla: r.sla,
    stuck: r.stuck,
  });
}

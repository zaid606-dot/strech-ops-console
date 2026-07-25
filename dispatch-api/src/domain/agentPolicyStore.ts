import type pg from 'pg';

import {
  type AgentPolicySettings,
  mergePolicyPatch,
  normalizePolicy,
} from './policy.js';

export async function loadAgentPolicy(
  client: pg.Pool | pg.PoolClient,
): Promise<{ version: number; settings: AgentPolicySettings; updated_at: string }> {
  const { rows } = await client.query(
    `SELECT version, settings, updated_at FROM agent_policy WHERE id = 1`,
  );
  if (!rows[0]) {
    return {
      version: 1,
      settings: normalizePolicy(null),
      updated_at: new Date().toISOString(),
    };
  }
  return {
    version: rows[0].version as number,
    settings: normalizePolicy(rows[0].settings),
    updated_at: rows[0].updated_at,
  };
}

export async function updateAgentPolicy(
  client: pg.PoolClient,
  opts: {
    patch: Parameters<typeof mergePolicyPatch>[1];
    updatedBy: string;
  },
) {
  const current = await loadAgentPolicy(client);
  const settings = mergePolicyPatch(current.settings, opts.patch);
  const { rows } = await client.query(
    `UPDATE agent_policy
     SET settings = $1::jsonb,
         version = version + 1,
         updated_at = now(),
         updated_by = $2
     WHERE id = 1
     RETURNING version, settings, updated_at`,
    [JSON.stringify(settings), opts.updatedBy],
  );
  return {
    version: rows[0].version as number,
    settings: normalizePolicy(rows[0].settings),
    updated_at: rows[0].updated_at as string,
  };
}

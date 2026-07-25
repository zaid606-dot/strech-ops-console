import { serve } from '@hono/node-server';

import { buildApp } from './app.js';
import { migrate } from './db/migrate.js';

async function main() {
  await migrate();
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';

  console.log(`strech-dispatch-api listening on http://${host}:${port}`);
  serve({ fetch: app.fetch, port, hostname: host });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

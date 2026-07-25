import { pathToFileURL } from 'node:url';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { pool } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export async function migrate() {
  await ensureMigrationsTable();
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const id = file;
    const exists = await pool.query(`SELECT 1 FROM schema_migrations WHERE id = $1`, [id]);
    if (exists.rowCount) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (id) VALUES ($1)`, [id]);
      await client.query('COMMIT');
      console.log(`applied ${id}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  migrate()
    .then(async () => {
      await pool.end();
      console.log('migrations complete');
    })
    .catch(async (e) => {
      console.error(e);
      await pool.end();
      process.exit(1);
    });
}

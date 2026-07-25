import pg from 'pg';

const { Pool } = pg;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required');
  }
  return url;
}

export const pool = new Pool({
  connectionString: databaseUrl(),
  max: 10,
});

export type DbClient = pg.Pool | pg.PoolClient;

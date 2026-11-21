import pg from 'pg';

const { Pool } = pg;

export function createPool() {
  const sslConfig =
    process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

  if (process.env.DATABASE_URL) {
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig,
      connectionTimeoutMillis: 3000
    });
  }

  return new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'shopnest_dev',
    user: process.env.DB_USER || 'shopnest_user',
    password: process.env.DB_PASSWORD || '',
    ssl: sslConfig,
    connectionTimeoutMillis: 3000
  });
}

export async function checkDbHealth(pool) {
  const result = await pool.query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

// Conexión a la MISMA base de Aiven que usa el sistema de Cristian.
import { Pool } from 'pg';

let pool;

function getPool() {
  if (!pool) {
    const connectionString = (process.env.DATABASE_URL || '').split('?')[0];
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      options: '-c search_path=palafox', // mismo schema que el sistema de Cristian
    });
  }
  return pool;
}

export async function query(text, params) {
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Conexión a Postgres (Aiven). Un solo pool reutilizado en toda la app.
import { Pool } from 'pg';

let pool;

function getPool() {
  if (!pool) {
    // Quitamos ?sslmode=... de la URL: versiones recientes de pg-connection-string
    // lo interpretan como "verify-full" y truena contra el certificado de Aiven
    // (self signed certificate in certificate chain). El SSL lo controlamos
    // explícitamente abajo con rejectUnauthorized:false.
    const connectionString = (process.env.DATABASE_URL || '').split('?')[0];
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // requerido por Aiven
      // Aísla este proyecto en su propio schema dentro del mismo servicio de
      // Aiven, para no tocar las tablas de Itzli ni de otros proyectos.
      options: '-c search_path=palafox',
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

// Registra un evento en la bitácora — nunca truena la operación principal
// si falla (por ejemplo, si todavía no se corrió la migración).
export async function logEvento({ sedeId, origen, tipo, descripcion }) {
  try {
    await query(
      'INSERT INTO bitacora (sede_id, origen, tipo, descripcion) VALUES ($1,$2,$3,$4)',
      [sedeId || null, origen, tipo, descripcion]
    );
  } catch (err) {
    console.error('No se pudo registrar en bitácora:', err.message);
  }
}

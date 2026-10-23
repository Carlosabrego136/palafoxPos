// Conexión a Postgres (Aiven). Un solo pool reutilizado en toda la app.
// Aiven limita las conexiones (compartidas con otros proyectos), así que el
// pool es chico y suelta rápido las conexiones que no usa.
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
      max: 2,                        // máximo de conexiones abiertas por instancia
      idleTimeoutMillis: 3000,       // cierra conexiones sin uso a los 3 s
      connectionTimeoutMillis: 12000, // espera máx. 12 s por una conexión
      statement_timeout: 15000,      // ninguna consulta se queda colgada
      query_timeout: 15000,
    });
    // Un error en una conexión inactiva no debe tumbar la función.
    pool.on('error', (err) => {
      console.error('Pool Postgres (conexión inactiva):', err.message);
    });
  }
  return pool;
}

// Errores al CONECTAR que vale la pena reintentar (límite de conexiones de
// Aiven, servidor arrancando, red). Nunca se reintentan errores de SQL.
const CODIGOS_REINTENTABLES = new Set(['53300', '57P03', 'ECONNRESET', 'ETIMEDOUT']);
const ESPERAS_MS = [300, 700, 1300];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function conectarConReintento() {
  for (let intento = 0; ; intento++) {
    try {
      return await getPool().connect();
    } catch (err) {
      const reintentable =
        CODIGOS_REINTENTABLES.has(err.code) || /timeout exceeded when trying to connect/i.test(err.message || '');
      if (!reintentable || intento >= ESPERAS_MS.length) throw err;
      await dormir(ESPERAS_MS[intento] + Math.floor(Math.random() * 200));
    }
  }
}

export async function query(text, params) {
  // Solo se reintenta la conexión; la consulta se ejecuta una sola vez.
  const client = await conectarConReintento();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function withTransaction(fn) {
  const client = await conectarConReintento();
  let falloConexion = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e) {
      // Si el ROLLBACK falla la conexión está rota: se descarta, y se
      // conserva el error original.
      falloConexion = true;
    }
    throw err;
  } finally {
    client.release(falloConexion ? true : undefined);
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

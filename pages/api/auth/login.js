import { createSessionCookie } from '../../../lib/auth';
import { query } from '../../../lib/db';
import { verifyPassword } from '../../../lib/passwords';

// sedeId debe coincidir con las sedes ya creadas en db/seed.sql del sistema
// de Cristian: 2 = Tienda 1, 3 = Tienda 2, 4 = Tienda 3.
// Estas son las cuentas compartidas de siempre — se quedan como respaldo.
// Si Cristian crea una cuenta individual desde el central con el mismo
// usuario, esa se revisa primero.
const TIENDAS = {
  tienda1: { sedeId: 2, nombre: 'Tienda 1 · Centro', password: process.env.TIENDA1_PASSWORD },
  tienda2: { sedeId: 3, nombre: 'Tienda 2 · Norte', password: process.env.TIENDA2_PASSWORD },
  tienda3: { sedeId: 4, nombre: 'Tienda 3 · Express', password: process.env.TIENDA3_PASSWORD },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const { usuario, password } = req.body || {};
  const user = String(usuario || '').toLowerCase().trim();
  if (!user || !password) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  // 1) Cuentas individuales creadas por Cristian en "Usuarios" del central.
  //    Si la tabla todavía no existe (no se ha corrido la migración), esto
  //    simplemente falla y seguimos de largo con las cuentas de siempre.
  try {
    const { rows } = await query(
      `SELECT u.*, s.nombre AS sede_nombre FROM usuarios u
       LEFT JOIN sedes s ON s.id = u.sede_id
       WHERE u.usuario = $1 AND u.activo = true`,
      [user]
    );
    const cuentaDb = rows[0];
    if (cuentaDb && verifyPassword(String(password), cuentaDb.password_hash)) {
      if (cuentaDb.rol === 'admin') {
        res.setHeader('Set-Cookie', createSessionCookie({ role: 'admin', cajeroNombre: cuentaDb.nombre }));
        return res.status(200).json({ role: 'admin' });
      }
      res.setHeader('Set-Cookie', createSessionCookie({
        role: 'tienda', sedeId: cuentaDb.sede_id, nombre: cuentaDb.sede_nombre, cajeroNombre: cuentaDb.nombre,
      }));
      return res.status(200).json({ role: 'tienda', sedeId: cuentaDb.sede_id, nombre: cuentaDb.sede_nombre });
    }
  } catch (err) {
    console.error('No se pudo revisar cuentas individuales (¿falta la migración en el central?):', err.message);
  }

  // 2) Acceso de administrador de siempre: Cristian puede entrar parado en
  // cualquier tienda, con su propia contraseña, y elige a cuál conectarse.
  if (user === 'admin') {
    if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    res.setHeader('Set-Cookie', createSessionCookie({ role: 'admin' }));
    return res.status(200).json({ role: 'admin' });
  }

  // 3) Cuentas compartidas de siempre (una sola contraseña por tienda).
  const cuenta = TIENDAS[user];
  if (!cuenta || !cuenta.password || password !== cuenta.password) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  res.setHeader('Set-Cookie', createSessionCookie({ role: 'tienda', sedeId: cuenta.sedeId, nombre: cuenta.nombre }));
  res.status(200).json({ role: 'tienda', sedeId: cuenta.sedeId, nombre: cuenta.nombre });
}

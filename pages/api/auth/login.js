import { createSessionCookie } from '../../../lib/auth';

// sedeId debe coincidir con las sedes ya creadas en db/seed.sql del sistema
// de Cristian: 2 = Tienda 1, 3 = Tienda 2, 4 = Tienda 3.
const TIENDAS = {
  tienda1: { sedeId: 2, nombre: 'Tienda 1 · Centro', password: process.env.TIENDA1_PASSWORD },
  tienda2: { sedeId: 3, nombre: 'Tienda 2 · Norte', password: process.env.TIENDA2_PASSWORD },
  tienda3: { sedeId: 4, nombre: 'Tienda 3 · Express', password: process.env.TIENDA3_PASSWORD },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  const { usuario, password } = req.body || {};
  const cuenta = TIENDAS[String(usuario || '').toLowerCase().trim()];

  if (!cuenta || !cuenta.password || password !== cuenta.password) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  res.setHeader('Set-Cookie', createSessionCookie({ sedeId: cuenta.sedeId, nombre: cuenta.nombre }));
  res.status(200).json({ sedeId: cuenta.sedeId, nombre: cuenta.nombre });
}

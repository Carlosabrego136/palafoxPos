import { query } from '../../lib/db';
import { requireSession } from '../../lib/auth';

// Catálogo — SOLO LECTURA desde el punto de venta. Crear, editar o dar de
// baja productos ahora se hace ÚNICAMENTE desde el sistema central
// (Cristian). El POS ya no expone POST/PATCH para este recurso, aunque
// alguien manipule el navegador o llame al endpoint directamente.
export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  if (req.method === 'GET') {
    try {
      const { rows } = await query('SELECT * FROM productos ORDER BY id');
      return res.status(200).json(rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al consultar productos' });
    }
  }

  if (req.method === 'POST' || req.method === 'PATCH') {
    return res.status(403).json({ error: 'El catálogo solo se puede editar desde el sistema central.' });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

import { query } from '../../lib/db';
import { requireSession } from '../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  const session = requireSession(req, res);
  if (!session) return;

  try {
    const sedeRes = await query('SELECT * FROM sedes WHERE id=$1', [session.sedeId]);
    if (sedeRes.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
    const reducido = sedeRes.rows[0].catalogo_reducido;

    const { rows } = await query(
      `SELECT p.id AS producto_id, p.sku_codigo, p.nombre, p.unidad_medida, p.precio_venta,
              COALESCE(i.stock_actual, 0) AS stock_actual,
              COALESCE(i.stock_minimo, 0) AS stock_minimo
       FROM productos p
       LEFT JOIN inventario_sedes i ON i.producto_id = p.id AND i.sede_id = $1
       WHERE ($2::boolean = false OR p.disponible_reducido = true)
       ORDER BY p.id`,
      [session.sedeId, reducido]
    );
    res.status(200).json({ sede: sedeRes.rows[0], inventario: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al consultar inventario' });
  }
}

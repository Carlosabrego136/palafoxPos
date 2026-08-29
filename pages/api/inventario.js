import { query } from '../../lib/db';
import { requireSession } from '../../lib/auth';

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  const sedeId = session.role === 'admin' ? req.query.sedeId : session.sedeId;
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' });

  if (req.method === 'GET') {
    try {
      const sedeRes = await query('SELECT * FROM sedes WHERE id=$1', [sedeId]);
      if (sedeRes.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });

      const { rows } = await query(
        `SELECT p.id AS producto_id, p.sku_codigo, p.nombre, p.unidad_medida, p.precio_venta,
                p.precio_mayoreo, p.cantidad_mayoreo, p.categoria,
                i.stock_actual, i.stock_minimo, i.alerta_desde, i.fecha_caducidad
         FROM inventario_sedes i
         JOIN productos p ON p.id = i.producto_id
         WHERE i.sede_id = $1 AND i.activo = true AND p.activo = true
         ORDER BY p.id`,
        [sedeId]
      );
      return res.status(200).json({ sede: sedeRes.rows[0], inventario: rows });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al consultar inventario' });
    }
  }

  // Editar stock, mínimo, o quitar un producto de una tienda ahora se hace
  // ÚNICAMENTE desde el sistema central (Cristian). El descuento de stock
  // por una venta NO pasa por aquí — se hace directo en /api/ventas, así
  // que bloquear este PATCH no afecta la venta normal.
  if (req.method === 'PATCH') {
    return res.status(403).json({ error: 'El inventario solo se puede editar desde el sistema central.' });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

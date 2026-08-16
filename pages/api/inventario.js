import { query } from '../../lib/db';
import { requireSession } from '../../lib/auth';

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;

  // Un trabajador siempre ve SU tienda, sin importar qué mande el navegador.
  // El admin puede pedir cualquier sede por query (?sedeId=).
  const sedeId = session.role === 'admin' ? req.query.sedeId : session.sedeId;
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' });

  if (req.method === 'GET') {
    try {
      const sedeRes = await query('SELECT * FROM sedes WHERE id=$1', [sedeId]);
      if (sedeRes.rows.length === 0) return res.status(404).json({ error: 'Sede no encontrada' });
      const reducido = sedeRes.rows[0].catalogo_reducido;

      const { rows } = await query(
        `SELECT p.id AS producto_id, p.sku_codigo, p.nombre, p.unidad_medida, p.precio_venta,
                COALESCE(i.stock_actual, 0) AS stock_actual,
                COALESCE(i.stock_minimo, 0) AS stock_minimo
         FROM productos p
         LEFT JOIN inventario_sedes i ON i.producto_id = p.id AND i.sede_id = $1
         WHERE p.activo = true AND ($2::boolean = false OR p.disponible_reducido = true)
         ORDER BY p.id`,
        [sedeId, reducido]
      );
      return res.status(200).json({ sede: sedeRes.rows[0], inventario: rows });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al consultar inventario' });
    }
  }

  if (req.method === 'PATCH') {
    if (session.role !== 'admin') return res.status(403).json({ error: 'No autorizado' });
    try {
      const { productoId, stockMinimo, stockActual } = req.body;
      if (productoId === undefined) return res.status(400).json({ error: 'Faltan datos' });
      await query(
        `INSERT INTO inventario_sedes (sede_id, producto_id, stock_actual, stock_minimo)
         VALUES ($1, $2, COALESCE($4, 0), COALESCE($3, 0))
         ON CONFLICT (sede_id, producto_id) DO UPDATE SET
           stock_minimo = COALESCE($3, inventario_sedes.stock_minimo),
           stock_actual = COALESCE($4, inventario_sedes.stock_actual)`,
        [sedeId, productoId, stockMinimo === undefined ? null : stockMinimo, stockActual === undefined ? null : stockActual]
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al actualizar el inventario' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

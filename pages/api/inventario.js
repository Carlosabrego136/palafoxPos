import { query, logEvento } from '../../lib/db';
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
                i.stock_actual, i.stock_minimo, i.alerta_desde
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

  if (req.method === 'PATCH') {
    try {
      const { productoId, stockMinimo, stockActual, disponible } = req.body;
      if (productoId === undefined) return res.status(400).json({ error: 'Faltan datos' });

      let alertaDesdeSql = 'inventario_sedes.alerta_desde';
      if (stockActual !== undefined) {
        const actual = await query(
          'SELECT stock_actual, stock_minimo FROM inventario_sedes WHERE sede_id=$1 AND producto_id=$2',
          [sedeId, productoId]
        );
        const prevStock = Number(actual.rows[0]?.stock_actual ?? 0);
        const minimo = stockMinimo !== undefined ? stockMinimo : Number(actual.rows[0]?.stock_minimo ?? 0);
        const bajoAntes = minimo > 0 && prevStock <= minimo;
        const bajoAhora = minimo > 0 && stockActual <= minimo;
        if (bajoAhora && !bajoAntes) alertaDesdeSql = 'NOW()';
        else if (!bajoAhora) alertaDesdeSql = 'NULL';
      }

      await query(
        `INSERT INTO inventario_sedes (sede_id, producto_id, stock_actual, stock_minimo, activo)
         VALUES ($1, $2, COALESCE($4, 0), COALESCE($3, 0), COALESCE($5, true))
         ON CONFLICT (sede_id, producto_id) DO UPDATE SET
           stock_minimo = COALESCE($3, inventario_sedes.stock_minimo),
           stock_actual = COALESCE($4, inventario_sedes.stock_actual),
           activo = COALESCE($5, inventario_sedes.activo),
           alerta_desde = ${alertaDesdeSql}`,
        [sedeId, productoId, stockMinimo === undefined ? null : stockMinimo, stockActual === undefined ? null : stockActual, disponible === undefined ? null : disponible]
      );

      const [prodRes, sedeRes] = await Promise.all([
        query('SELECT nombre FROM productos WHERE id=$1', [productoId]),
        query('SELECT nombre FROM sedes WHERE id=$1', [sedeId]),
      ]);
      const origen = session.role === 'admin' ? 'Cristian (admin)' : session.nombre;
      const nombreProd = prodRes.rows[0]?.nombre || 'producto';
      const nombreSede = sedeRes.rows[0]?.nombre || 'sede';

      if (disponible !== undefined) {
        await logEvento({
          sedeId, origen,
          tipo: disponible ? 'producto_asignado' : 'producto_quitado_tienda',
          descripcion: `${disponible ? 'Agregó' : 'Quitó'} "${nombreProd}" ${disponible ? 'a' : 'de'} ${nombreSede}`,
        });
      } else if (stockActual !== undefined) {
        await logEvento({
          sedeId, origen, tipo: 'stock_corregido',
          descripcion: `Corrigió el stock de "${nombreProd}" en ${nombreSede} → ${stockActual}`,
        });
      } else {
        await logEvento({
          sedeId, origen, tipo: 'minimo_editado',
          descripcion: `Cambió el mínimo de "${nombreProd}" en ${nombreSede} → ${stockMinimo}`,
        });
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al actualizar el inventario' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

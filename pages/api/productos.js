import { query, logEvento } from '../../lib/db';
import { requireSession } from '../../lib/auth';

// Gestión de catálogo desde el punto de venta — disponible para CUALQUIER
// sesión válida (trabajador o admin), no solo administrador. Cada cambio
// queda registrado en la bitácora con el origen exacto (qué tienda, o
// Cristian), para que el sistema central lo muestre en tiempo real.
export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  const origen = session.role === 'admin' ? 'Cristian (admin)' : session.nombre;

  if (req.method === 'GET') {
    try {
      const { rows } = await query('SELECT * FROM productos ORDER BY id');
      return res.status(200).json(rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al consultar productos' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { skuCodigo, nombre, unidadMedida, precioVenta, disponibleReducido } = req.body;
      if (!nombre || !unidadMedida || precioVenta === undefined || precioVenta === '') {
        return res.status(400).json({ error: 'Faltan datos del producto' });
      }
      const { rows } = await query(
        `INSERT INTO productos (sku_codigo, nombre, unidad_medida, precio_venta, disponible_reducido)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [skuCodigo || null, nombre, unidadMedida, precioVenta, disponibleReducido !== false]
      );
      await logEvento({
        sedeId: session.role === 'tienda' ? session.sedeId : null,
        origen,
        tipo: 'producto_creado',
        descripcion: `Creó el producto "${nombre}" — $${precioVenta}/${unidadMedida}`,
      });
      return res.status(201).json(rows[0]);
    } catch (err) {
      console.error(err);
      if (err.code === '23505') return res.status(400).json({ error: 'Ese SKU ya existe' });
      return res.status(500).json({ error: 'Error al crear el producto' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { id, skuCodigo, nombre, unidadMedida, precioVenta, disponibleReducido, activo } = req.body;
      if (!id) return res.status(400).json({ error: 'Falta el id del producto' });
      const { rows } = await query(
        `UPDATE productos SET
           sku_codigo = COALESCE($2, sku_codigo),
           nombre = COALESCE($3, nombre),
           unidad_medida = COALESCE($4, unidad_medida),
           precio_venta = COALESCE($5, precio_venta),
           disponible_reducido = COALESCE($6, disponible_reducido),
           activo = COALESCE($7, activo)
         WHERE id = $1 RETURNING *`,
        [
          id,
          skuCodigo ?? null,
          nombre ?? null,
          unidadMedida ?? null,
          precioVenta ?? null,
          disponibleReducido === undefined ? null : disponibleReducido,
          activo === undefined ? null : activo,
        ]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
      const cambios = [];
      if (precioVenta !== undefined && precioVenta !== null) cambios.push(`precio → $${precioVenta}`);
      if (unidadMedida) cambios.push(`unidad → ${unidadMedida}`);
      if (nombre) cambios.push(`nombre → "${nombre}"`);
      await logEvento({
        sedeId: session.role === 'tienda' ? session.sedeId : null,
        origen,
        tipo: 'producto_editado',
        descripcion: `Editó "${rows[0].nombre}"${cambios.length ? ': ' + cambios.join(', ') : ''}`,
      });
      return res.status(200).json(rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al actualizar el producto' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Falta el id del producto' });
      const prodRes = await query('SELECT nombre FROM productos WHERE id=$1', [id]);
      await query('UPDATE productos SET activo = false WHERE id = $1', [id]);
      await logEvento({
        sedeId: session.role === 'tienda' ? session.sedeId : null,
        origen,
        tipo: 'producto_baja',
        descripcion: `Dio de baja "${prodRes.rows[0]?.nombre || 'producto'}"`,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al eliminar el producto' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

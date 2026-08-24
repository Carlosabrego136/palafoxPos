import { query, logEvento } from '../../lib/db';
import { requireSession } from '../../lib/auth';

// Gestión de catálogo desde el punto de venta. Al crear un producto aquí,
// se asigna SOLO a la tienda desde la que se creó (o la que el admin tenga
// seleccionada) — nunca aparece automáticamente en las otras tiendas.
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
      const { skuCodigo, nombre, unidadMedida, precioVenta, sedeId, stockInicial, stockMinimo } = req.body;
      const sedeDestino = session.role === 'admin' ? sedeId : session.sedeId;
      if (!nombre || !unidadMedida || precioVenta === undefined || precioVenta === '' || !sedeDestino) {
        return res.status(400).json({ error: 'Faltan datos del producto' });
      }
      const { rows } = await query(
        `INSERT INTO productos (sku_codigo, nombre, unidad_medida, precio_venta)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [skuCodigo || null, nombre, unidadMedida, precioVenta]
      );
      const producto = rows[0];

      await query(
        `INSERT INTO inventario_sedes (sede_id, producto_id, stock_actual, stock_minimo, activo)
         VALUES ($1, $2, $3, $4, true)`,
        [sedeDestino, producto.id, stockInicial || 0, stockMinimo || 0]
      );

      const sedeRes = await query('SELECT nombre FROM sedes WHERE id=$1', [sedeDestino]);
      await logEvento({
        sedeId: sedeDestino,
        origen,
        tipo: 'producto_creado',
        descripcion: `Creó "${nombre}" — $${precioVenta}/${unidadMedida} — solo en ${sedeRes.rows[0]?.nombre}`,
      });

      return res.status(201).json(producto);
    } catch (err) {
      console.error(err);
      if (err.code === '23505') return res.status(400).json({ error: 'Ese SKU ya existe' });
      return res.status(500).json({ error: 'Error al crear el producto' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { id, skuCodigo, nombre, unidadMedida, precioVenta, precioMayoreo, cantidadMayoreo, activo } = req.body;
      if (!id) return res.status(400).json({ error: 'Falta el id del producto' });
      const { rows } = await query(
        `UPDATE productos SET
           sku_codigo = COALESCE($2, sku_codigo),
           nombre = COALESCE($3, nombre),
           unidad_medida = COALESCE($4, unidad_medida),
           precio_venta = COALESCE($5, precio_venta),
           precio_mayoreo = CASE WHEN $6::boolean THEN $7 ELSE precio_mayoreo END,
           cantidad_mayoreo = CASE WHEN $6::boolean THEN $8 ELSE cantidad_mayoreo END,
           activo = COALESCE($9, activo)
         WHERE id = $1 RETURNING *`,
        [
          id,
          skuCodigo ?? null,
          nombre ?? null,
          unidadMedida ?? null,
          precioVenta ?? null,
          precioMayoreo !== undefined || cantidadMayoreo !== undefined,
          precioMayoreo === undefined ? null : (precioMayoreo === '' ? null : precioMayoreo),
          cantidadMayoreo === undefined ? null : (cantidadMayoreo === '' ? null : cantidadMayoreo),
          activo === undefined ? null : activo,
        ]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Producto no encontrado' });
      const cambios = [];
      if (precioVenta !== undefined && precioVenta !== null) cambios.push(`precio → $${precioVenta}`);
      if (unidadMedida) cambios.push(`unidad → ${unidadMedida}`);
      if (nombre) cambios.push(`nombre → "${nombre}"`);
      if (precioMayoreo !== undefined || cantidadMayoreo !== undefined) {
        cambios.push(
          rows[0].precio_mayoreo
            ? `mayoreo → $${rows[0].precio_mayoreo} desde ${rows[0].cantidad_mayoreo}`
            : 'mayoreo desactivado'
        );
      }
      await logEvento({
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

  return res.status(405).json({ error: 'Método no permitido' });
}

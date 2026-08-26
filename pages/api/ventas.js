import { withTransaction } from '../../lib/db';
import { requireSession } from '../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const session = requireSession(req, res);
  if (!session) return;

  const { items } = req.body;
  const sedeId = session.role === 'admin' ? req.body.sedeId : session.sedeId;
  const metodoPago = ['efectivo', 'tarjeta', 'transferencia'].includes(req.body.metodoPago) ? req.body.metodoPago : 'efectivo';
  if (!sedeId) return res.status(400).json({ error: 'Falta la tienda' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Datos de venta incompletos' });
  }

  try {
    const result = await withTransaction(async (client) => {
      let total = 0;
      const alertas = [];
      const itemsParaGuardar = [];

      for (const item of items) {
        // --- Venta libre: producto que no está en catálogo ---
        if (item.libre) {
          const cantidad = Number(item.cantidad);
          const precio = Number(item.precioUnitario);
          if (!item.nombre || !cantidad || cantidad <= 0 || !precio || precio <= 0) {
            throw new Error('Datos incompletos en la venta libre');
          }
          const subtotal = precio * cantidad;
          total += subtotal;
          itemsParaGuardar.push({
            productoId: null,
            nombreLibre: item.nombre,
            unidadLibre: item.unidad || null,
            cantidad,
            precioUnitario: precio,
            subtotal,
          });
          continue;
        }

        // --- Producto de catálogo (con posible precio ajustado) ---
        const invRes = await client.query(
          'SELECT stock_actual, stock_minimo FROM inventario_sedes WHERE sede_id=$1 AND producto_id=$2 FOR UPDATE',
          [sedeId, item.productoId]
        );
        const stockActual = Number(invRes.rows[0]?.stock_actual || 0);
        const stockMinimo = Number(invRes.rows[0]?.stock_minimo || 0);

        const prodRes = await client.query('SELECT precio_venta, nombre FROM productos WHERE id=$1 AND activo = true', [item.productoId]);
        if (prodRes.rows.length === 0) throw new Error('Producto no disponible');
        const nombreProd = prodRes.rows[0].nombre;

        if (stockActual < item.cantidad) {
          throw new Error(`Stock insuficiente de ${nombreProd}`);
        }

        const precio = item.precioOverride ? Number(item.precioOverride) : Number(prodRes.rows[0].precio_venta);
        const subtotal = precio * item.cantidad;
        total += subtotal;
        itemsParaGuardar.push({
          productoId: item.productoId,
          nombreLibre: null,
          unidadLibre: null,
          cantidad: item.cantidad,
          precioUnitario: precio,
          subtotal,
        });

        const nuevoStock = stockActual - item.cantidad;
        const bajoAntes = stockMinimo > 0 && stockActual <= stockMinimo;
        const bajoAhora = stockMinimo > 0 && nuevoStock <= stockMinimo;
        await client.query(
          `UPDATE inventario_sedes SET stock_actual = $1,
             alerta_desde = ${bajoAhora && !bajoAntes ? 'NOW()' : bajoAhora ? 'alerta_desde' : 'NULL'}
           WHERE sede_id=$2 AND producto_id=$3`,
          [nuevoStock, sedeId, item.productoId]
        );

        if (bajoAhora && !bajoAntes) {
          alertas.push(nombreProd);
        }
      }

      const ventaRes = await client.query(
        'INSERT INTO ventas (sede_id, total, metodo_pago) VALUES ($1, $2, $3) RETURNING *',
        [sedeId, total, metodoPago]
      );
      const venta = ventaRes.rows[0];

      for (const item of itemsParaGuardar) {
        await client.query(
          `INSERT INTO detalle_ventas
             (venta_id, producto_id, cantidad, subtotal, nombre_libre, unidad_libre, precio_unitario)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [venta.id, item.productoId, item.cantidad, item.subtotal, item.nombreLibre, item.unidadLibre, item.precioUnitario]
        );
      }

      return { venta, alertas };
    });

    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || 'Error al registrar la venta' });
  }
}

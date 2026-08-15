import { withTransaction } from '../../lib/db';
import { requireSession } from '../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const session = requireSession(req, res);
  if (!session) return;

  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Datos de venta incompletos' });
  }

  try {
    const result = await withTransaction(async (client) => {
      let total = 0;
      const alertas = [];
      const itemsConSubtotal = [];

      for (const item of items) {
        const invRes = await client.query(
          'SELECT stock_actual, stock_minimo FROM inventario_sedes WHERE sede_id=$1 AND producto_id=$2 FOR UPDATE',
          [session.sedeId, item.productoId]
        );
        const stockActual = Number(invRes.rows[0]?.stock_actual || 0);
        const stockMinimo = Number(invRes.rows[0]?.stock_minimo || 0);

        const prodRes = await client.query('SELECT precio_venta, nombre FROM productos WHERE id=$1', [item.productoId]);
        const nombreProd = prodRes.rows[0]?.nombre || 'producto';

        if (stockActual < item.cantidad) {
          throw new Error(`Stock insuficiente de ${nombreProd}`);
        }

        const precio = Number(prodRes.rows[0].precio_venta);
        const subtotal = precio * item.cantidad;
        total += subtotal;
        itemsConSubtotal.push({ ...item, subtotal });

        const nuevoStock = stockActual - item.cantidad;
        await client.query(
          'UPDATE inventario_sedes SET stock_actual = $1 WHERE sede_id=$2 AND producto_id=$3',
          [nuevoStock, session.sedeId, item.productoId]
        );

        if (stockMinimo > 0 && stockActual > stockMinimo && nuevoStock <= stockMinimo) {
          alertas.push(nombreProd);
        }
      }

      const ventaRes = await client.query(
        'INSERT INTO ventas (sede_id, total) VALUES ($1, $2) RETURNING *',
        [session.sedeId, total]
      );
      const venta = ventaRes.rows[0];

      for (const item of itemsConSubtotal) {
        await client.query(
          'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, subtotal) VALUES ($1,$2,$3,$4)',
          [venta.id, item.productoId, item.cantidad, item.subtotal]
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

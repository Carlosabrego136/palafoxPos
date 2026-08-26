import { query, logEvento } from '../../lib/db';
import { requireSession } from '../../lib/auth';

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  const sedeId = session.role === 'admin' ? req.query.sedeId : session.sedeId;
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' });
  const cajero = session.role === 'admin' ? 'Cristian (admin)' : session.nombre;

  if (req.method === 'GET') {
    try {
      const { rows } = await query(
        `SELECT * FROM movimientos_caja WHERE sede_id=$1 ORDER BY fecha DESC LIMIT 50`,
        [sedeId]
      );
      return res.status(200).json(rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al consultar movimientos' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { tipo, monto, concepto } = req.body;
      if (!['deposito', 'retiro'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
      const m = Number(monto);
      if (!m || m <= 0) return res.status(400).json({ error: 'Monto inválido' });

      const { rows } = await query(
        `INSERT INTO movimientos_caja (sede_id, cajero, tipo, monto, concepto) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [sedeId, cajero, tipo, m, concepto || null]
      );

      await logEvento({
        sedeId, origen: cajero,
        tipo: tipo === 'retiro' ? 'caja_retiro' : 'caja_deposito',
        descripcion: `${tipo === 'retiro' ? 'Retiró' : 'Depositó'} $${m.toFixed(2)} de la caja${concepto ? ` — ${concepto}` : ''}`,
      });

      return res.status(201).json(rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al registrar el movimiento' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

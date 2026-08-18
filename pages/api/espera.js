import { query } from '../../lib/db';
import { requireSession } from '../../lib/auth';

// Tickets pausados a medias — para cuando llega otro cliente y hay que
// atenderlo antes de terminar el anterior. Cada sede solo ve las suyas.
export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  const sedeId = session.role === 'admin' ? req.query.sedeId : session.sedeId;
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' });

  if (req.method === 'GET') {
    try {
      const { rows } = await query(
        'SELECT * FROM ventas_en_espera WHERE sede_id=$1 ORDER BY fecha DESC',
        [sedeId]
      );
      return res.status(200).json(rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al consultar ventas en espera' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { ticket, nota } = req.body;
      if (!Array.isArray(ticket) || ticket.length === 0) {
        return res.status(400).json({ error: 'El ticket está vacío' });
      }
      const { rows } = await query(
        'INSERT INTO ventas_en_espera (sede_id, nota, ticket) VALUES ($1,$2,$3) RETURNING *',
        [sedeId, nota || null, JSON.stringify(ticket)]
      );
      return res.status(201).json(rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al poner en espera' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Falta el id' });
      await query('DELETE FROM ventas_en_espera WHERE id=$1 AND sede_id=$2', [id, sedeId]);
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al quitar de espera' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

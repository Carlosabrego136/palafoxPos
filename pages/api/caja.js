import { query, logEvento } from '../../lib/db';
import { requireSession } from '../../lib/auth';

// Calcula el efectivo esperado desde la última apertura/intermedio hasta
// ahora: fondo con el que se abrió + ventas en efectivo + depósitos - retiros.
async function calcularEsperado(sedeId, desde, fondoBase) {
  const ventasRes = await query(
    `SELECT COALESCE(SUM(total),0) AS total FROM ventas
     WHERE sede_id=$1 AND metodo_pago='efectivo' AND fecha >= $2`,
    [sedeId, desde]
  );
  const movRes = await query(
    `SELECT tipo, COALESCE(SUM(monto),0) AS total FROM movimientos_caja
     WHERE sede_id=$1 AND fecha >= $2 GROUP BY tipo`,
    [sedeId, desde]
  );
  const depositos = Number(movRes.rows.find((r) => r.tipo === 'deposito')?.total || 0);
  const retiros = Number(movRes.rows.find((r) => r.tipo === 'retiro')?.total || 0);
  const ventasEfectivo = Number(ventasRes.rows[0].total);
  return {
    fondoBase, ventasEfectivo, depositos, retiros,
    esperado: fondoBase + ventasEfectivo + depositos - retiros,
  };
}

export default async function handler(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  const sedeId = session.role === 'admin' ? req.query.sedeId : session.sedeId;
  if (!sedeId) return res.status(400).json({ error: 'Falta sedeId' });
  // Si entró con una cuenta individual, usamos su nombre real (para que
  // quede en el corte quién fue exactamente). Si no, se comporta igual que
  // siempre: nombre de la tienda, o "Cristian (admin)" para el admin de
  // toda la vida.
  const cajero = session.cajeroNombre
    ? session.cajeroNombre
    : (session.role === 'admin' ? 'Cristian (admin)' : session.nombre);

  if (req.method === 'GET') {
    try {
      // El corte más reciente de esta sede
      const ultimoRes = await query(
        `SELECT * FROM cortes_caja WHERE sede_id=$1 ORDER BY fecha DESC LIMIT 1`,
        [sedeId]
      );
      const ultimo = ultimoRes.rows[0] || null;
      const abierta = !!ultimo && ultimo.tipo !== 'cierre';

      // El POS solo necesita saber si la caja está abierta y, si acaso, el
      // fondo/efectivo contado que ELLOS MISMOS registraron. El "esperado"
      // y la "diferencia" (sobrante/faltante) NUNCA se le mandan al punto
      // de venta — esa comparación solo la ve Cristian desde el central,
      // para poder detectar discrepancias sin que el cajero sepa cuánto
      // "debería" cuadrar antes de contar.
      const ultimoSinComparacion = ultimo
        ? { id: ultimo.id, sede_id: ultimo.sede_id, cajero: ultimo.cajero, tipo: ultimo.tipo, fondo_inicial: ultimo.fondo_inicial, efectivo_contado: ultimo.efectivo_contado, nota: ultimo.nota, fecha: ultimo.fecha }
        : null;

      return res.status(200).json({ abierta, ultimo: ultimoSinComparacion });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al consultar la caja' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { tipo, fondoInicial, efectivoContado, nota } = req.body;
      if (!['apertura', 'intermedio', 'cierre'].includes(tipo)) {
        return res.status(400).json({ error: 'Tipo de corte inválido' });
      }

      if (tipo === 'apertura') {
        const ultimoRes = await query(
          `SELECT tipo FROM cortes_caja WHERE sede_id=$1 ORDER BY fecha DESC LIMIT 1`,
          [sedeId]
        );
        if (ultimoRes.rows[0] && ultimoRes.rows[0].tipo !== 'cierre') {
          return res.status(400).json({ error: 'Ya hay una caja abierta en esta tienda' });
        }
        const fondo = Number(fondoInicial) || 0;
        const { rows } = await query(
          `INSERT INTO cortes_caja (sede_id, cajero, tipo, fondo_inicial) VALUES ($1,$2,'apertura',$3) RETURNING *`,
          [sedeId, cajero, fondo]
        );
        await logEvento({ sedeId, origen: cajero, tipo: 'caja_apertura', descripcion: `Abrió caja con fondo de $${fondo.toFixed(2)}` });
        return res.status(201).json(rows[0]);
      }

      // intermedio o cierre: necesitamos la apertura vigente para calcular lo esperado
      const aperturaRes = await query(
        `SELECT * FROM cortes_caja WHERE sede_id=$1 AND tipo='apertura' ORDER BY fecha DESC LIMIT 1`,
        [sedeId]
      );
      const apertura = aperturaRes.rows[0];
      if (!apertura) return res.status(400).json({ error: 'No hay una caja abierta para cortar' });

      const { esperado } = await calcularEsperado(sedeId, apertura.fecha, Number(apertura.fondo_inicial));
      const contado = Number(efectivoContado) || 0;
      const diferencia = contado - esperado;

      const { rows } = await query(
        `INSERT INTO cortes_caja (sede_id, cajero, tipo, efectivo_contado, efectivo_esperado, diferencia, nota)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [sedeId, cajero, tipo, contado, esperado, diferencia, nota || null]
      );

      const signo = diferencia === 0 ? 'cuadró exacto' : diferencia > 0 ? `sobrante de $${diferencia.toFixed(2)}` : `faltante de $${Math.abs(diferencia).toFixed(2)}`;
      await logEvento({
        sedeId, origen: cajero,
        tipo: tipo === 'cierre' ? 'caja_cierre' : 'caja_intermedio',
        descripcion: `${tipo === 'cierre' ? 'Cerró' : 'Hizo corte intermedio de'} caja — contado $${contado.toFixed(2)}, esperado $${esperado.toFixed(2)} (${signo})`,
      });

      // Igual que en el GET: el cajero solo recibe de vuelta lo que él mismo
      // contó. El esperado/diferencia queda guardado en la base de datos
      // (para que Cristian lo revise desde el central) pero no viaja de
      // regreso al punto de venta.
      const { efectivo_esperado, diferencia: _diferencia, ...corteSinComparacion } = rows[0];
      return res.status(201).json(corteSinComparacion);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Error al registrar el corte' });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

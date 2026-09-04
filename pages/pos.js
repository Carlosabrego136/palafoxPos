import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { getSession } from '../lib/auth';

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) return { redirect: { destination: '/login', permanent: false } };
  return { props: { session } };
}

const UNIDADES = ['kg', 'gr', 'lt', 'pza'];

export default function POS({ session }) {
  const router = useRouter();
  const esAdmin = session.role === 'admin';

  const [tab, setTab] = useState('vender');
  const [sedes, setSedes] = useState([]);
  const [sedeId, setSedeId] = useState(esAdmin ? null : session.sedeId);
  const [sedeNombre, setSedeNombre] = useState(esAdmin ? '' : session.nombre);
  const [inv, setInv] = useState(null);
  const [ticket, setTicket] = useState([]);
  const [modalProd, setModalProd] = useState(null);
  const [qtyVal, setQtyVal] = useState('');
  const [precioVal, setPrecioVal] = useState('');
  const [modoCantidad, setModoCantidad] = useState('cantidad'); // 'cantidad' | 'importe'
  const [importeVal, setImporteVal] = useState('');
  const [libreOpen, setLibreOpen] = useState(false);
  const [libre, setLibre] = useState({ nombre: '', unidad: 'pza', precio: '', cantidad: '' });
  const [toast, setToast] = useState(null);
  const [espera, setEspera] = useState([]);
  const [esperaOpen, setEsperaOpen] = useState(false);

  // Caja: apertura/corte/movimientos de efectivo
  const [caja, setCaja] = useState(null);
  const [cajaLoading, setCajaLoading] = useState(true);
  const [aperturaVal, setAperturaVal] = useState('');
  const [corteOpen, setCorteOpen] = useState(false);
  const [corteTipo, setCorteTipo] = useState('intermedio');
  const [corteContado, setCorteContado] = useState('');
  const [corteNota, setCorteNota] = useState('');
  const [corteResultado, setCorteResultado] = useState(null);
  const [retiroOpen, setRetiroOpen] = useState(false);
  const [retiroTipo, setRetiroTipo] = useState('retiro');
  const [retiroMonto, setRetiroMonto] = useState('');
  const [retiroConcepto, setRetiroConcepto] = useState('');
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [notifOpen, setNotifOpen] = useState(false);
  const [reciboOpen, setReciboOpen] = useState(false);
  const [reciboData, setReciboData] = useState(null);

  // Solo para acomodo visual: buscador y filtro de categoría en la pantalla de venta.
  const [busqueda, setBusqueda] = useState('');
  const [categoriaActiva, setCategoriaActiva] = useState('todas');

  useEffect(() => {
    if (!esAdmin) return;
    fetch('/api/sedes').then((r) => r.json()).then((list) => {
      setSedes(list);
      if (list[0]) { setSedeId(list[0].id); setSedeNombre(list[0].nombre); }
    });
  }, [esAdmin]);

  useEffect(() => {
    if (!sedeId) return;
    cargarInventario();
    cargarEspera();
    cargarCaja();
    setTicket([]);
    // Se refresca sola cada 10s — si Cristian cambia un precio o el stock
    // desde el sistema central, aquí se ve reflejado sin recargar la página.
    const t = setInterval(() => { cargarInventario(); cargarCaja(); }, 10000);
    return () => clearInterval(t);
  }, [sedeId]);

  function cargarInventario() {
    fetch(`/api/inventario?sedeId=${sedeId}`).then((r) => r.json()).then(setInv);
  }

  function cargarEspera() {
    fetch(`/api/espera?sedeId=${sedeId}`).then((r) => r.json()).then(setEspera);
  }

  function cargarCaja() {
    fetch(`/api/caja?sedeId=${sedeId}`).then((r) => r.json()).then((d) => { setCaja(d); setCajaLoading(false); });
  }

  function showToast(text, err = false) {
    setToast({ text, err });
    setTimeout(() => setToast(null), 2800);
  }

  function abrirModal(p) {
    setModalProd(p);
    setQtyVal('');
    setImporteVal('');
    setModoCantidad('cantidad');
    setPrecioVal(String(p.precio_venta));
  }

  // Cantidad efectiva: si está en modo "importe", se calcula desde el $ escrito.
  const cantidadEfectiva = modoCantidad === 'importe'
    ? (parseFloat(importeVal) > 0 && parseFloat(precioVal) > 0 ? parseFloat(importeVal) / parseFloat(precioVal) : 0)
    : parseFloat(qtyVal) || 0;

  const sugerirMayoreo = modalProd && modalProd.cantidad_mayoreo && modalProd.precio_mayoreo &&
    cantidadEfectiva >= Number(modalProd.cantidad_mayoreo) &&
    Number(precioVal) !== Number(modalProd.precio_mayoreo);

  function agregar() {
    const cant = modoCantidad === 'importe' ? cantidadEfectiva : parseFloat(qtyVal);
    const precio = parseFloat(precioVal);
    if (!cant || cant <= 0) { showToast('Cantidad inválida', true); return; }
    if (!precio || precio <= 0) { showToast('Precio inválido', true); return; }
    const yaEnTicket = ticket.filter((t) => t.producto_id === modalProd.producto_id).reduce((a, t) => a + t.cantidad, 0);
    if (cant + yaEnTicket > Number(modalProd.stock_actual)) {
      showToast(`Solo hay ${modalProd.stock_actual} ${modalProd.unidad_medida} disponibles`, true);
      return;
    }
    setTicket([
      ...ticket,
      {
        producto_id: modalProd.producto_id,
        nombre: modalProd.nombre,
        unidad_medida: modalProd.unidad_medida,
        precio_venta: precio,
        precioOriginal: modalProd.precio_venta,
        cantidad: cant,
      },
    ]);
    setModalProd(null);
  }

  function agregarLibre(e) {
    e.preventDefault();
    const cant = parseFloat(libre.cantidad);
    const precio = parseFloat(libre.precio);
    if (!libre.nombre || !cant || cant <= 0 || !precio || precio <= 0) {
      showToast('Completa nombre, cantidad y precio', true);
      return;
    }
    setTicket([
      ...ticket,
      { libre: true, nombre: libre.nombre, unidad_medida: libre.unidad, precio_venta: precio, cantidad: cant },
    ]);
    setLibre({ nombre: '', unidad: 'pza', precio: '', cantidad: '' });
    setLibreOpen(false);
  }

  function quitar(idx) {
    setTicket(ticket.filter((_, i) => i !== idx));
  }

  const total = ticket.reduce((s, t) => s + Number(t.precio_venta) * t.cantidad, 0);

  async function cobrar() {
    const items = ticket.map((t) => {
      if (t.libre) {
        return { libre: true, nombre: t.nombre, unidad: t.unidad_medida, precioUnitario: t.precio_venta, cantidad: t.cantidad };
      }
      const item = { productoId: t.producto_id, cantidad: t.cantidad };
      if (Number(t.precio_venta) !== Number(t.precioOriginal)) item.precioOverride = t.precio_venta;
      return item;
    });

    const res = await fetch('/api/ventas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sedeId, items, metodoPago }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'No se pudo cobrar', true); return; }
    setReciboData({ venta: data.venta, items: ticket, metodoPago, sedeNombre, sedeInfo: inv?.sede || null });
    setReciboOpen(true);
    setTicket([]);
    setMetodoPago('efectivo');
    cargarInventario();
    cargarCaja();
    if (data.alertas?.length) {
      showToast(`Venta cobrada. ⚠ Bajo mínimo: ${data.alertas.join(', ')}`, true);
    } else {
      showToast(`Venta cobrada por $${Number(data.venta.total).toFixed(2)}`);
    }
  }

  async function salir() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  async function ponerEnEspera() {
    if (ticket.length === 0) return;
    const nota = prompt('Nota para identificar esta venta (opcional, ej. nombre del cliente):', '') || '';
    const res = await fetch(`/api/espera?sedeId=${sedeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, nota }),
    });
    if (!res.ok) { showToast('No se pudo poner en espera', true); return; }
    setTicket([]);
    cargarEspera();
    showToast('Venta puesta en espera.');
  }

  function recuperarEspera(item) {
    if (ticket.length > 0 && !confirm('Ya tienes un ticket abierto — se va a reemplazar por este. ¿Continuar?')) return;
    setTicket(item.ticket);
    setEsperaOpen(false);
    fetch(`/api/espera?sedeId=${sedeId}&id=${item.id}`, { method: 'DELETE' }).then(cargarEspera);
  }

  async function borrarEspera(id) {
    if (!confirm('¿Borrar esta venta en espera? No se puede deshacer.')) return;
    await fetch(`/api/espera?sedeId=${sedeId}&id=${id}`, { method: 'DELETE' });
    cargarEspera();
  }

  // ---- Caja: apertura ----
  async function abrirCaja(e) {
    e.preventDefault();
    const fondo = parseFloat(aperturaVal) || 0;
    const res = await fetch(`/api/caja?sedeId=${sedeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: 'apertura', fondoInicial: fondo }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'No se pudo abrir la caja', true); return; }
    setAperturaVal('');
    cargarCaja();
    showToast(`Caja abierta con fondo de $${fondo.toFixed(2)}`);
  }

  // ---- Caja: corte intermedio o cierre ----
  function abrirModalCorte(tipo) {
    setCorteTipo(tipo);
    setCorteContado('');
    setCorteNota('');
    setCorteResultado(null);
    setCorteOpen(true);
  }

  async function confirmarCorte() {
    const contado = parseFloat(corteContado);
    if (isNaN(contado) || contado < 0) { showToast('Escribe cuánto efectivo contaste', true); return; }
    const res = await fetch(`/api/caja?sedeId=${sedeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: corteTipo, efectivoContado: contado, nota: corteNota || null }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'No se pudo hacer el corte', true); return; }
    setCorteResultado(data);
    cargarCaja();
  }

  function cerrarModalCorte() {
    setCorteOpen(false);
    setCorteResultado(null);
  }

  // ---- Movimientos de efectivo: retiro / depósito ----
  function abrirModalRetiro(tipo) {
    setRetiroTipo(tipo);
    setRetiroMonto('');
    setRetiroConcepto('');
    setRetiroOpen(true);
  }

  async function confirmarMovimiento(e) {
    e.preventDefault();
    const monto = parseFloat(retiroMonto);
    if (!monto || monto <= 0) { showToast('Monto inválido', true); return; }
    const res = await fetch(`/api/movimientos?sedeId=${sedeId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo: retiroTipo, monto, concepto: retiroConcepto || null }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'No se pudo registrar', true); return; }
    setRetiroOpen(false);
    cargarCaja();
    showToast(`${retiroTipo === 'retiro' ? 'Retiro' : 'Depósito'} de $${monto.toFixed(2)} registrado.`);
  }

  const categorias = ['todas', ...new Set((inv?.inventario || []).map((p) => p.categoria).filter(Boolean))];
  // Los artículos NO se listan solos — solo aparecen cuando hay una búsqueda activa
  // (por nombre, palabra clave, o SKU/código completo).
  const hayBusqueda = busqueda.trim().length > 0;
  const inventarioFiltrado = !hayBusqueda ? [] : (inv?.inventario || []).filter((p) => {
    const coincideTexto = p.nombre.toLowerCase().includes(busqueda.toLowerCase()) || (p.sku_codigo || '').toLowerCase().includes(busqueda.toLowerCase());
    const coincideCategoria = categoriaActiva === 'todas' || p.categoria === categoriaActiva;
    return coincideTexto && coincideCategoria;
  });

  // Notificaciones: stock bajo/agotado + caducidad, calculadas del inventario ya cargado.
  const notifStock = (inv?.inventario || []).filter((p) => Number(p.stock_minimo) > 0 && Number(p.stock_actual) <= Number(p.stock_minimo));
  const hoy = new Date();
  const notifCaducidad = (inv?.inventario || []).filter((p) => {
    if (!p.fecha_caducidad) return false;
    const soloFecha = String(p.fecha_caducidad).slice(0, 10);
    const dias = Math.round((new Date(soloFecha + 'T00:00:00') - hoy) / 86400000);
    return dias <= 15;
  });
  const totalNotificaciones = notifStock.length + notifCaducidad.length;

  const inicialCajero = (session.cajeroNombre || (esAdmin ? 'Admin' : sedeNombre) || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="pos-page">
      <header className="pos-topbar-v2">
        <div className="pos-brand-block">
          <div className="brand">PALA<span>FOX</span></div>
          <div className="pos-tienda-tag">{sedeNombre || '—'}</div>
        </div>

        {esAdmin && (
          <select value={sedeId || ''} onChange={(e) => {
            const s = sedes.find((x) => x.id === Number(e.target.value));
            setSedeId(s.id); setSedeNombre(s.nombre);
          }}>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        )}

        <div className="pos-nav-group">
          <button className={`pos-nav-btn ${tab === 'vender' ? 'active' : ''}`} onClick={() => setTab('vender')}>
            <span className="ic">🛒</span>Vender
          </button>
          <button className="pos-nav-btn" onClick={() => setEsperaOpen(true)} style={{ position: 'relative' }}>
            <span className="ic">⏸</span>En espera
            {espera.length > 0 && <span className="badge-count">{espera.length}</span>}
          </button>
        </div>

        {!cajaLoading && caja?.abierta && (
          <div className="pos-nav-group">
            <button className="pos-nav-btn" onClick={() => abrirModalRetiro('retiro')}>
              <span className="ic">💵</span>Retirar
            </button>
            <button className="pos-nav-btn" onClick={() => abrirModalRetiro('deposito')}>
              <span className="ic">➕</span>Depositar
            </button>
            <button className="pos-nav-btn" onClick={() => abrirModalCorte('intermedio')}>
              <span className="ic">🧾</span>Corte
            </button>
            <button className="pos-nav-btn" onClick={() => abrirModalCorte('cierre')}>
              <span className="ic">🔒</span>Cerrar caja
            </button>
          </div>
        )}

        <div className="pos-spacer" />

        <div style={{ position: 'relative' }}>
          <button className="pos-nav-btn" onClick={() => setNotifOpen(!notifOpen)} style={{ position: 'relative' }}>
            <span className="ic">🔔</span>
            {totalNotificaciones > 0 && <span className="badge-count">{totalNotificaciones}</span>}
          </button>
          {notifOpen && (
            <div className="notif-panel">
              <div className="notif-panel-head">Notificaciones — {sedeNombre}</div>
              {totalNotificaciones === 0 ? (
                <p className="sub" style={{ padding: '14px 16px' }}>Todo tranquilo por aquí. ✓</p>
              ) : (
                <>
                  {notifStock.map((p) => (
                    <div className="notif-item" key={`s-${p.producto_id}`}>
                      <span className="notif-dot low" />
                      <div>
                        <div className="notif-title">{p.nombre}</div>
                        <div className="notif-sub">
                          {Number(p.stock_actual) <= 0 ? 'Se agotó' : `Quedan ${p.stock_actual} ${p.unidad_medida}`} — mínimo {p.stock_minimo} {p.unidad_medida}
                        </div>
                      </div>
                    </div>
                  ))}
                  {notifCaducidad.map((p) => {
                    const soloFecha = String(p.fecha_caducidad).slice(0, 10);
                    const dias = Math.round((new Date(soloFecha + 'T00:00:00') - hoy) / 86400000);
                    return (
                      <div className="notif-item" key={`c-${p.producto_id}`}>
                        <span className="notif-dot warn" />
                        <div>
                          <div className="notif-title">{p.nombre}</div>
                          <div className="notif-sub">{dias < 0 ? 'Ya caducó' : dias === 0 ? 'Caduca hoy' : `Caduca en ${dias} día(s)`}</div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        <div className="pos-cashier">
          <div className="pos-cashier-info">
            <div className="nm">{session.cajeroNombre || (esAdmin ? 'Cristian' : sedeNombre)}</div>
            <div className="rl">{esAdmin ? 'Administrador' : 'Punto de venta'}</div>
          </div>
          <div className="pos-avatar">{inicialCajero}</div>
        </div>
        <button className="btn secondary small" onClick={salir}>Salir</button>
      </header>

      {cajaLoading ? (
        <main className="main" style={{ padding: '60px 28px', textAlign: 'center' }}>
          <p className="empty-state">Revisando el estado de la caja…</p>
        </main>
      ) : !caja?.abierta ? (
        <main className="main" style={{ padding: '60px 28px', display: 'flex', justifyContent: 'center' }}>
          <div className="panel" style={{ maxWidth: 380, width: '100%' }}>
            <h2 className="panel-title">Abrir caja — {sedeNombre}</h2>
            <p className="page-sub" style={{ marginBottom: 18 }}>
              Antes de vender, cuenta el efectivo con el que arrancas el día (el "fondo"). Al hacer un corte más tarde, solo vas a anotar el efectivo que cuentes — la comparación se revisa desde la base central.
            </p>
            <form onSubmit={abrirCaja}>
              <label>Fondo inicial ($)</label>
              <input type="number" min="0" step="0.01" autoFocus required value={aperturaVal}
                onChange={(e) => setAperturaVal(e.target.value)} placeholder="0.00" style={{ width: '100%', marginBottom: 16 }} />
              <button className="btn full" type="submit">Abrir caja</button>
            </form>
          </div>
        </main>
      ) : (
        <div className="pos-body">
          <div className="pos-main-col">
            <div className="pos-search-row">
              <input
                type="text"
                placeholder="Buscar producto por nombre o SKU..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>

            {hayBusqueda && categorias.length > 1 && (
              <div className="category-chip-row">
                {categorias.map((c) => (
                  <span key={c} className={`category-chip ${categoriaActiva === c ? 'active' : ''}`}
                    onClick={() => setCategoriaActiva(c)}>
                    {c === 'todas' ? 'Todas' : c}
                  </span>
                ))}
              </div>
            )}

            <div className="pos-grid-v2">
              {inv?.inventario.length === 0 ? (
                <p className="empty-state">Esta tienda todavía no tiene productos. Pídele a Cristian que los agregue desde el sistema central.</p>
              ) : !hayBusqueda ? (
                <p className="empty-state">Escribe el nombre, una palabra clave o el código del producto para buscarlo.</p>
              ) : inventarioFiltrado.length === 0 ? (
                <p className="empty-state">Nada coincide con esa búsqueda.</p>
              ) : (
                inventarioFiltrado.map((p) => {
                  const sinStock = Number(p.stock_actual) <= 0;
                  const bajo = Number(p.stock_minimo) > 0 && Number(p.stock_actual) <= Number(p.stock_minimo);
                  return (
                    <div key={p.producto_id} className={`pos-card-v2 ${sinStock ? 'disabled' : ''}`}
                      onClick={() => !sinStock && abrirModal(p)}>
                      <div className="cat-tag">{p.categoria || p.sku_codigo || '—'}</div>
                      <div className="nm">{p.nombre}</div>
                      <div className="price-block">
                        <div className="pr">${Number(p.precio_venta).toFixed(2)} <span className="unit">/ {p.unidad_medida}</span></div>
                        {p.precio_mayoreo && (
                          <div className="mayoreo-tag">Mayoreo ${Number(p.precio_mayoreo).toFixed(2)} desde {p.cantidad_mayoreo}</div>
                        )}
                        <div className="stock-row">
                          <span className={`stock-pill ${bajo ? 'low' : ''}`}>
                            {p.stock_actual} {p.unidad_medida}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="ticket-col">
            <div className="ticket-head">
              <h2>Ticket</h2>
              <span className="ticket-count">{ticket.length} art.</span>
            </div>
            <div className="ticket-scroll">
              {ticket.length === 0 ? (
                <p className="empty-ticket">Toca un producto para agregarlo</p>
              ) : (
                ticket.map((t, idx) => (
                  <div className="ticket-row-v2" key={idx}>
                    <div>
                      <div className="n">{t.nombre}{t.libre ? ' (libre)' : ''}</div>
                      <div className="q">{t.cantidad} {t.unidad_medida} × ${Number(t.precio_venta).toFixed(2)}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="amt">${(t.cantidad * t.precio_venta).toFixed(2)}</span>
                      <button className="btn small secondary" onClick={() => quitar(idx)}>✕</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="ticket-footer">
              <div className="ticket-actions-row">
                <button className="btn secondary" onClick={() => setLibreOpen(true)}>+ Libre</button>
                <button className="btn secondary" disabled={ticket.length === 0} onClick={ponerEnEspera}>En espera</button>
              </div>
              <div className="pago-row">
                {['efectivo', 'tarjeta', 'transferencia'].map((m) => (
                  <button key={m} type="button" className={`pago-chip ${metodoPago === m ? 'active' : ''}`}
                    onClick={() => setMetodoPago(m)}>
                    {m === 'efectivo' ? '💵 Efectivo' : m === 'tarjeta' ? '💳 Tarjeta' : '🏦 Transferencia'}
                  </button>
                ))}
              </div>
              <div className="ticket-total-v2">
                <span className="lbl">Total</span>
                <span className="amt">${total.toFixed(2)}</span>
              </div>
              <button className="btn full" disabled={ticket.length === 0} onClick={cobrar}>Cobrar</button>
            </div>
          </div>
        </div>
      )}

      {modalProd && (
        <div className="qty-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setModalProd(null); }}>
          <div className="qty-modal">
            <h3>{modalProd.nombre}</h3>
            <p className="sub">{modalProd.stock_actual} {modalProd.unidad_medida} disponibles</p>

            <div className="row" style={{ marginBottom: 12 }}>
              <button type="button" className={`btn small ${modoCantidad === 'cantidad' ? '' : 'secondary'}`}
                onClick={() => setModoCantidad('cantidad')}>Por cantidad</button>
              <button type="button" className={`btn small ${modoCantidad === 'importe' ? '' : 'secondary'}`}
                onClick={() => setModoCantidad('importe')}>Por importe ($)</button>
            </div>

            {modoCantidad === 'cantidad' ? (
              <>
                <label>Cantidad ({modalProd.unidad_medida})</label>
                <input type="number" min="0" step="any" autoFocus value={qtyVal}
                  onChange={(e) => setQtyVal(e.target.value)} style={{ marginBottom: 12 }} />
              </>
            ) : (
              <>
                <label>El cliente quiere pagar ($)</label>
                <input type="number" min="0" step="0.01" autoFocus value={importeVal}
                  onChange={(e) => setImporteVal(e.target.value)} style={{ marginBottom: 6 }} />
                <p className="sub" style={{ marginBottom: 12 }}>
                  = {cantidadEfectiva > 0 ? cantidadEfectiva.toFixed(3) : '0'} {modalProd.unidad_medida}
                </p>
              </>
            )}

            <label>Precio (puedes ajustarlo)</label>
            <input type="number" min="0" step="0.01" value={precioVal}
              onChange={(e) => setPrecioVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }} />

            {sugerirMayoreo && (
              <button type="button" className="btn small secondary full" style={{ marginTop: 10 }}
                onClick={() => setPrecioVal(String(modalProd.precio_mayoreo))}>
                Usar precio mayoreo (${Number(modalProd.precio_mayoreo).toFixed(2)}) — aplica desde {modalProd.cantidad_mayoreo} {modalProd.unidad_medida}
              </button>
            )}

            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn secondary" onClick={() => setModalProd(null)}>Cancelar</button>
              <button className="btn" onClick={agregar}>Agregar</button>
            </div>
          </div>
        </div>
      )}

      {libreOpen && (
        <div className="qty-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setLibreOpen(false); }}>
          <form className="qty-modal" onSubmit={agregarLibre}>
            <h3>Venta libre</h3>
            <p className="sub">Para algo que no está en el catálogo</p>
            <label>Nombre</label>
            <input required value={libre.nombre} onChange={(e) => setLibre({ ...libre, nombre: e.target.value })} style={{ marginBottom: 12 }} />
            <label>Unidad</label>
            <select value={libre.unidad} onChange={(e) => setLibre({ ...libre, unidad: e.target.value })} style={{ marginBottom: 12, width: '100%' }}>
              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <label>Cantidad</label>
            <input required type="number" min="0" step="any" value={libre.cantidad}
              onChange={(e) => setLibre({ ...libre, cantidad: e.target.value })} style={{ marginBottom: 12 }} />
            <label>Precio</label>
            <input required type="number" min="0" step="0.01" value={libre.precio}
              onChange={(e) => setLibre({ ...libre, precio: e.target.value })} />
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn secondary" type="button" onClick={() => setLibreOpen(false)}>Cancelar</button>
              <button className="btn" type="submit">Agregar</button>
            </div>
          </form>
        </div>
      )}

      {esperaOpen && (
        <div className="qty-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setEsperaOpen(false); }}>
          <div className="qty-modal" style={{ width: 360 }}>
            <h3>Ventas en espera</h3>
            {espera.length === 0 ? (
              <p className="sub">No hay ninguna pausada.</p>
            ) : (
              espera.map((item) => {
                const totalItem = item.ticket.reduce((s, t) => s + Number(t.precio_venta) * t.cantidad, 0);
                return (
                  <div key={item.id} className="ticket-item" style={{ alignItems: 'center' }}>
                    <div>
                      <div className="n">{item.nota || `Venta #${item.id}`}</div>
                      <div className="q">{item.ticket.length} artículo(s) · ${totalItem.toFixed(2)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn small" onClick={() => recuperarEspera(item)}>Retomar</button>
                      <button className="btn small secondary" onClick={() => borrarEspera(item.id)}>✕</button>
                    </div>
                  </div>
                );
              })
            )}
            <button className="btn secondary full" style={{ marginTop: 14 }} onClick={() => setEsperaOpen(false)}>Cerrar</button>
          </div>
        </div>
      )}

      {corteOpen && (
        <div className="qty-modal-bg" onClick={(e) => { if (e.target === e.currentTarget && corteResultado) cerrarModalCorte(); }}>
          <div className="qty-modal">
            {!corteResultado ? (
              <>
                <h3>{corteTipo === 'cierre' ? 'Cerrar caja' : 'Corte intermedio'} — {sedeNombre}</h3>
                <p className="sub" style={{ marginBottom: 14 }}>
                  Cuenta el efectivo físico que hay ahora mismo en la caja y escríbelo aquí.
                </p>
                <label>Efectivo contado ($)</label>
                <input type="number" min="0" step="0.01" autoFocus value={corteContado}
                  onChange={(e) => setCorteContado(e.target.value)} style={{ marginBottom: 12 }} />
                <label>Nota (opcional)</label>
                <input value={corteNota} onChange={(e) => setCorteNota(e.target.value)} placeholder="Ej. faltó cambio en la mañana" />
                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn secondary" onClick={() => setCorteOpen(false)}>Cancelar</button>
                  <button className="btn" onClick={confirmarCorte}>Confirmar</button>
                </div>
              </>
            ) : (
              <>
                <h3>{corteTipo === 'cierre' ? 'Caja cerrada' : 'Corte registrado'}</h3>
                <div className="corte-resultado">
                  <div className="fila"><span>Efectivo contado</span><span className="mono">${Number(corteResultado.efectivo_contado).toFixed(2)}</span></div>
                </div>
                <p className="sub" style={{ marginTop: 10 }}>Quedó registrado. La base central lo revisa y cuadra desde ahí.</p>
                <button className="btn full" style={{ marginTop: 16 }} onClick={cerrarModalCorte}>Listo</button>
              </>
            )}
          </div>
        </div>
      )}

      {retiroOpen && (
        <div className="qty-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setRetiroOpen(false); }}>
          <form className="qty-modal" onSubmit={confirmarMovimiento}>
            <h3>{retiroTipo === 'retiro' ? 'Retirar efectivo' : 'Depositar efectivo'}</h3>
            <p className="sub" style={{ marginBottom: 14 }}>{sedeNombre}</p>
            <label>Monto ($)</label>
            <input required type="number" min="0" step="0.01" autoFocus value={retiroMonto}
              onChange={(e) => setRetiroMonto(e.target.value)} style={{ marginBottom: 12 }} />
            <label>Concepto (opcional)</label>
            <input value={retiroConcepto} onChange={(e) => setRetiroConcepto(e.target.value)} placeholder="Ej. pago a proveedor" />
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn secondary" type="button" onClick={() => setRetiroOpen(false)}>Cancelar</button>
              <button className="btn" type="submit">{retiroTipo === 'retiro' ? 'Retirar' : 'Depositar'}</button>
            </div>
          </form>
        </div>
      )}

      {reciboOpen && reciboData && typeof document !== 'undefined' && createPortal(
        <div className="qty-modal-bg recibo-portal" onClick={(e) => { if (e.target === e.currentTarget) setReciboOpen(false); }}>
          <div className="recibo-modal">
            <div className="recibo-imprimible">
              <div className="recibo-header">
                <div className="brand" style={{ fontSize: 20, justifyContent: 'center' }}>PALA<span>FOX</span></div>
                <div>{reciboData.sedeNombre}</div>
                {reciboData.sedeInfo?.recibo_direccion && <div>{reciboData.sedeInfo.recibo_direccion}</div>}
                {reciboData.sedeInfo?.recibo_telefono && <div>Tel: {reciboData.sedeInfo.recibo_telefono}</div>}
                <div className="mono">{new Date(reciboData.venta.fecha).toLocaleString('es-MX')}</div>
                <div className="mono">Venta #{reciboData.venta.id}</div>
              </div>
              <div className="recibo-items">
                {reciboData.items.map((t, i) => (
                  <div className="recibo-linea" key={i}>
                    <div>{t.nombre}{t.libre ? ' (libre)' : ''}</div>
                    <div className="mono">{t.cantidad} {t.unidad_medida} × ${Number(t.precio_venta).toFixed(2)} = ${(t.cantidad * t.precio_venta).toFixed(2)}</div>
                  </div>
                ))}
              </div>
              <div className="recibo-total">
                <span>TOTAL</span>
                <span className="mono">${Number(reciboData.venta.total).toFixed(2)}</span>
              </div>
              <div className="mono" style={{ textAlign: 'center', marginTop: 10, fontSize: 12 }}>
                Pago: {reciboData.metodoPago === 'efectivo' ? 'EFECTIVO' : reciboData.metodoPago === 'tarjeta' ? 'TARJETA' : 'TRANSFERENCIA'}
              </div>
              <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12.5, color: 'var(--text-dim)' }}>
                {reciboData.sedeInfo?.recibo_mensaje || '¡Gracias por su compra!'}
              </div>
            </div>
            <div className="row recibo-botones" style={{ marginTop: 18 }}>
              <button className="btn secondary" onClick={() => setReciboOpen(false)}>Cerrar</button>
              <button className="btn" onClick={() => window.print()}>Imprimir</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.text}</div>}
    </div>
  );
}

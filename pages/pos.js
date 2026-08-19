import { useEffect, useState } from 'react';
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

  // Edición completa de un producto de ESTA tienda (nombre/precio/unidad/stock/mínimo)
  const [editProd, setEditProd] = useState(null);
  const [editVals, setEditVals] = useState({});

  // Catálogo — crear producto nuevo (queda solo en esta tienda)
  const [nuevo, setNuevo] = useState({ skuCodigo: '', nombre: '', unidadMedida: 'kg', precioVenta: '', stockInicial: '', stockMinimo: '' });

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
    setTicket([]);
    // Se refresca sola cada 10s — si Cristian cambia un precio o el stock
    // desde el sistema central, aquí se ve reflejado sin recargar la página.
    const t = setInterval(cargarInventario, 10000);
    return () => clearInterval(t);
  }, [sedeId]);

  function cargarInventario() {
    fetch(`/api/inventario?sedeId=${sedeId}`).then((r) => r.json()).then(setInv);
  }

  function cargarEspera() {
    fetch(`/api/espera?sedeId=${sedeId}`).then((r) => r.json()).then(setEspera);
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
      body: JSON.stringify({ sedeId, items }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'No se pudo cobrar', true); return; }
    setTicket([]);
    cargarInventario();
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

  // ---- Crear producto nuevo (solo queda en ESTA tienda) ----
  async function crearProducto(e) {
    e.preventDefault();
    const res = await fetch('/api/productos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skuCodigo: nuevo.skuCodigo || null,
        nombre: nuevo.nombre,
        unidadMedida: nuevo.unidadMedida,
        precioVenta: parseFloat(nuevo.precioVenta),
        sedeId,
        stockInicial: parseFloat(nuevo.stockInicial) || 0,
        stockMinimo: parseFloat(nuevo.stockMinimo) || 0,
      }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'No se pudo crear', true); return; }
    showToast(`"${data.nombre}" creado en ${sedeNombre}.`);
    setNuevo({ skuCodigo: '', nombre: '', unidadMedida: 'kg', precioVenta: '', stockInicial: '', stockMinimo: '' });
    cargarInventario();
  }

  // ---- Editar producto completo (nombre/precio/unidad/stock/mínimo) ----
  function abrirEdicion(p) {
    setEditProd(p);
    setEditVals({
      nombre: p.nombre,
      unidadMedida: p.unidad_medida,
      precioVenta: String(p.precio_venta),
      stockActual: String(p.stock_actual),
      stockMinimo: String(p.stock_minimo),
    });
  }

  async function guardarEdicion() {
    await fetch('/api/productos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editProd.producto_id,
        nombre: editVals.nombre,
        unidadMedida: editVals.unidadMedida,
        precioVenta: parseFloat(editVals.precioVenta),
      }),
    });
    await fetch(`/api/inventario?sedeId=${sedeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productoId: editProd.producto_id,
        stockActual: parseFloat(editVals.stockActual),
        stockMinimo: parseFloat(editVals.stockMinimo),
      }),
    });
    setEditProd(null);
    cargarInventario();
    showToast('Producto actualizado.');
  }

  async function quitarDeTienda() {
    if (!confirm(`¿Quitar "${editProd.nombre}" de ${sedeNombre}? Sigue existiendo en las demás tiendas.`)) return;
    await fetch(`/api/inventario?sedeId=${sedeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productoId: editProd.producto_id, disponible: false }),
    });
    setEditProd(null);
    cargarInventario();
  }

  const categorias = ['todas', ...new Set((inv?.inventario || []).map((p) => p.categoria).filter(Boolean))];
  const inventarioFiltrado = (inv?.inventario || []).filter((p) => {
    const coincideTexto = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase()) || (p.sku_codigo || '').toLowerCase().includes(busqueda.toLowerCase());
    const coincideCategoria = categoriaActiva === 'todas' || p.categoria === categoriaActiva;
    return coincideTexto && coincideCategoria;
  });

  const inicialCajero = esAdmin ? 'A' : (sedeNombre || '?').trim().charAt(0).toUpperCase();

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
          <button className={`pos-nav-btn ${tab === 'catalogo' ? 'active' : ''}`} onClick={() => setTab('catalogo')}>
            <span className="ic">＋</span>Producto
          </button>
          <button className="pos-nav-btn" onClick={() => setEsperaOpen(true)} style={{ position: 'relative' }}>
            <span className="ic">⏸</span>En espera
            {espera.length > 0 && <span className="badge-count">{espera.length}</span>}
          </button>
        </div>

        <div className="pos-spacer" />

        <div className="pos-cashier">
          <div className="pos-cashier-info">
            <div className="nm">{esAdmin ? 'Cristian' : sedeNombre}</div>
            <div className="rl">{esAdmin ? 'Administrador' : 'Punto de venta'}</div>
          </div>
          <div className="pos-avatar">{inicialCajero}</div>
        </div>
        <button className="btn secondary small" onClick={salir}>Salir</button>
      </header>

      {tab === 'catalogo' ? (
        <main className="main" style={{ padding: '24px 28px 60px' }}>
          <section className="panel">
            <h2 className="panel-title">Nuevo producto en {sedeNombre}</h2>
            <p className="page-sub" style={{ marginBottom: 16 }}>Este producto solo va a aparecer aquí — no en las otras tiendas.</p>
            <div className="help-box">
              <strong>SKU</strong>: código interno opcional, solo para identificarlo rápido.<br/>
              <strong>Stock inicial</strong>: cuántas unidades tienes ahora mismo — sin esto el producto nace en 0 y no se puede vender hasta que le pongas cantidad.<br/>
              <strong>Mínimo</strong>: cuando el stock llegue a este número o menos, aparece en Alertas para Cristian. Déjalo en 0 si no quieres alerta.
            </div>
            <form className="form-row" onSubmit={crearProducto}>
              <div>
                <label>SKU (opcional)</label>
                <input value={nuevo.skuCodigo} onChange={(e) => setNuevo({ ...nuevo, skuCodigo: e.target.value })} />
              </div>
              <div>
                <label>Nombre</label>
                <input required value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
              </div>
              <div>
                <label>Unidad</label>
                <select value={nuevo.unidadMedida} onChange={(e) => setNuevo({ ...nuevo, unidadMedida: e.target.value })}>
                  {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label>Precio</label>
                <input required type="number" min="0" step="0.01" value={nuevo.precioVenta}
                  onChange={(e) => setNuevo({ ...nuevo, precioVenta: e.target.value })} />
              </div>
              <div>
                <label>Stock inicial</label>
                <input type="number" min="0" step="any" value={nuevo.stockInicial}
                  onChange={(e) => setNuevo({ ...nuevo, stockInicial: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label>Mínimo</label>
                <input type="number" min="0" step="any" value={nuevo.stockMinimo}
                  onChange={(e) => setNuevo({ ...nuevo, stockMinimo: e.target.value })} placeholder="0" />
              </div>
              <button className="btn" type="submit">Crear en {sedeNombre}</button>
            </form>
          </section>
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

            {categorias.length > 1 && (
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
              {inv?.inventario.length === 0 && (
                <p className="empty-state">Esta tienda todavía no tiene productos. Usa "Producto" arriba.</p>
              )}
              {inv?.inventario.length > 0 && inventarioFiltrado.length === 0 && (
                <p className="empty-state">Nada coincide con esa búsqueda.</p>
              )}
              {inventarioFiltrado.map((p) => {
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
                        <button className="edit-btn" onClick={(e) => { e.stopPropagation(); abrirEdicion(p); }}>
                          Editar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
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

      {editProd && (
        <div className="qty-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setEditProd(null); }}>
          <div className="qty-modal">
            <h3>Editar en {sedeNombre}</h3>
            <label>Nombre</label>
            <input value={editVals.nombre} onChange={(e) => setEditVals({ ...editVals, nombre: e.target.value })} style={{ marginBottom: 12 }} />
            <label>Unidad</label>
            <select value={editVals.unidadMedida} onChange={(e) => setEditVals({ ...editVals, unidadMedida: e.target.value })} style={{ marginBottom: 12, width: '100%' }}>
              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <label>Precio</label>
            <input type="number" min="0" step="0.01" value={editVals.precioVenta}
              onChange={(e) => setEditVals({ ...editVals, precioVenta: e.target.value })} style={{ marginBottom: 12 }} />
            <label>Stock en {sedeNombre}</label>
            <input type="number" min="0" step="any" value={editVals.stockActual}
              onChange={(e) => setEditVals({ ...editVals, stockActual: e.target.value })} style={{ marginBottom: 12 }} />
            <label>Mínimo en {sedeNombre}</label>
            <input type="number" min="0" step="any" value={editVals.stockMinimo}
              onChange={(e) => setEditVals({ ...editVals, stockMinimo: e.target.value })} />
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn secondary" onClick={() => setEditProd(null)}>Cancelar</button>
              <button className="btn" onClick={guardarEdicion}>Guardar</button>
            </div>
            <button className="btn secondary full" style={{ marginTop: 10 }} onClick={quitarDeTienda}>
              Quitar de {sedeNombre}
            </button>
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

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.text}</div>}
    </div>
  );
}

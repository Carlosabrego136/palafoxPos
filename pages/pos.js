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

  const [tab, setTab] = useState('vender'); // 'vender' | 'catalogo' (solo admin)
  const [sedes, setSedes] = useState([]);
  const [sedeId, setSedeId] = useState(esAdmin ? null : session.sedeId);
  const [sedeNombre, setSedeNombre] = useState(esAdmin ? '' : session.nombre);
  const [inv, setInv] = useState(null);
  const [ticket, setTicket] = useState([]);
  const [modalProd, setModalProd] = useState(null);
  const [qtyVal, setQtyVal] = useState('');
  const [precioVal, setPrecioVal] = useState('');
  const [libreOpen, setLibreOpen] = useState(false);
  const [libre, setLibre] = useState({ nombre: '', unidad: 'pza', precio: '', cantidad: '' });
  const [toast, setToast] = useState(null);

  // Catálogo (solo admin)
  const [productos, setProductos] = useState([]);
  const [nuevo, setNuevo] = useState({ skuCodigo: '', nombre: '', unidadMedida: 'kg', precioVenta: '', disponibleReducido: true });

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
    setTicket([]);
  }, [sedeId]);

  function cargarInventario() {
    fetch(`/api/inventario?sedeId=${sedeId}`).then((r) => r.json()).then(setInv);
  }

  function cargarCatalogo() {
    fetch('/api/productos').then((r) => r.json()).then(setProductos);
  }

  useEffect(() => { if (tab === 'catalogo') cargarCatalogo(); }, [tab]);

  function showToast(text, err = false) {
    setToast({ text, err });
    setTimeout(() => setToast(null), 2800);
  }

  function abrirModal(p) {
    setModalProd(p);
    setQtyVal('');
    setPrecioVal(String(p.precio_venta));
  }

  function agregar() {
    const cant = parseFloat(qtyVal);
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

  // ---- Gestión de catálogo (solo admin) ----
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
        disponibleReducido: nuevo.disponibleReducido,
      }),
    });
    const data = await res.json();
    if (!res.ok) { showToast(data.error || 'No se pudo crear', true); return; }
    showToast(`"${data.nombre}" creado.`);
    setNuevo({ skuCodigo: '', nombre: '', unidadMedida: 'kg', precioVenta: '', disponibleReducido: true });
    cargarCatalogo();
  }

  async function actualizarProducto(id, campo, valor) {
    await fetch('/api/productos', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, [campo]: valor }),
    });
    cargarCatalogo();
    if (sedeId) cargarInventario();
  }

  async function eliminarProducto(id, nombre) {
    if (!confirm(`¿Dar de baja "${nombre}"? Deja de venderse en las 3 tiendas, pero su historial se conserva.`)) return;
    await fetch(`/api/productos?id=${id}`, { method: 'DELETE' });
    cargarCatalogo();
    if (sedeId) cargarInventario();
  }

  async function corregirStock(productoId, actual) {
    const val = prompt('Corregir stock de esta tienda (conteo físico, etc.):', actual);
    if (val === null) return;
    const n = parseFloat(val);
    if (isNaN(n) || n < 0) return;
    await fetch(`/api/inventario?sedeId=${sedeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productoId, stockActual: n }),
    });
    cargarInventario();
  }

  return (
    <div className="pos-page">
      <header className="pos-topbar">
        <div className="brand">PALA<span>FOX</span></div>
        {esAdmin ? (
          <>
            <span className="pos-mode-badge">Admin</span>
            <select value={sedeId || ''} onChange={(e) => {
              const s = sedes.find((x) => x.id === Number(e.target.value));
              setSedeId(s.id); setSedeNombre(s.nombre);
            }}>
              {sedes.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
            <div className="form-row" style={{ margin: 0, gap: 8 }}>
              <button className={`btn small ${tab === 'vender' ? '' : 'secondary'}`} onClick={() => setTab('vender')}>Vender</button>
              <button className={`btn small ${tab === 'catalogo' ? '' : 'secondary'}`} onClick={() => setTab('catalogo')}>Catálogo</button>
            </div>
          </>
        ) : (
          <div className="pos-tienda-nombre">{sedeNombre}</div>
        )}
        <button className="btn secondary small" onClick={salir}>Cerrar sesión</button>
      </header>

      <main className="main" style={{ padding: '24px 28px 60px' }}>
        {tab === 'catalogo' && esAdmin ? (
          <>
            <section className="panel">
              <h2 className="panel-title">Nuevo producto</h2>
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
                <button className="btn" type="submit">Crear</button>
              </form>
            </section>

            <section className="panel">
              <h2 className="panel-title">Catálogo completo</h2>
              <table>
                <thead>
                  <tr><th>Nombre</th><th>Unidad</th><th className="num">Precio</th><th>Estado</th><th></th></tr>
                </thead>
                <tbody>
                  {productos.map((p) => (
                    <tr key={p.id} style={{ opacity: p.activo ? 1 : 0.5 }}>
                      <td><input defaultValue={p.nombre} onBlur={(e) => e.target.value !== p.nombre && actualizarProducto(p.id, 'nombre', e.target.value)} /></td>
                      <td className="mono">{p.unidad_medida}</td>
                      <td className="num">
                        <input className="min-input" type="number" min="0" step="0.01" defaultValue={p.precio_venta}
                          onBlur={(e) => actualizarProducto(p.id, 'precioVenta', parseFloat(e.target.value))} />
                      </td>
                      <td><span className={`badge ${p.activo ? 'ok' : 'low'}`}>{p.activo ? 'ACTIVO' : 'DE BAJA'}</span></td>
                      <td>
                        {p.activo ? (
                          <button className="btn small secondary" onClick={() => eliminarProducto(p.id, p.nombre)}>Dar de baja</button>
                        ) : (
                          <button className="btn small" onClick={() => actualizarProducto(p.id, 'activo', true)}>Reactivar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        ) : (
          <>
            {inv?.sede?.catalogo_reducido && <p className="catalogo-note">◆ Catálogo reducido para esta tienda</p>}

            <div className="pos-layout">
              <div className="pos-grid">
                {inv?.inventario.map((p) => {
                  const sinStock = Number(p.stock_actual) <= 0;
                  const bajo = Number(p.stock_minimo) > 0 && Number(p.stock_actual) <= Number(p.stock_minimo);
                  return (
                    <div key={p.producto_id} className={`pos-card ${sinStock ? 'disabled' : ''}`}
                      onClick={() => !sinStock && abrirModal(p)}>
                      <div className="sku">{p.sku_codigo}</div>
                      <div className="nm">{p.nombre}</div>
                      <div className="pr">${Number(p.precio_venta).toFixed(2)} / {p.unidad_medida}</div>
                      <div className="st" style={{ color: bajo ? 'var(--danger)' : undefined }}>
                        {p.stock_actual} {p.unidad_medida} disp.{bajo ? ' ⚠' : ''}
                      </div>
                      {esAdmin && (
                        <button className="btn small secondary" style={{ marginTop: 8 }}
                          onClick={(e) => { e.stopPropagation(); corregirStock(p.producto_id, p.stock_actual); }}>
                          Corregir stock
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="ticket">
                <h2 className="panel-title">Ticket</h2>
                {ticket.length === 0 ? (
                  <p className="empty-ticket">Toca un producto para agregarlo</p>
                ) : (
                  ticket.map((t, idx) => (
                    <div className="ticket-item" key={idx}>
                      <div>
                        <div className="n">{t.nombre}{t.libre ? ' (libre)' : ''}</div>
                        <div className="q">{t.cantidad} {t.unidad_medida} × ${Number(t.precio_venta).toFixed(2)}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="mono">${(t.cantidad * t.precio_venta).toFixed(2)}</span>
                        <button className="btn small secondary" onClick={() => quitar(idx)}>✕</button>
                      </div>
                    </div>
                  ))
                )}
                <button className="btn secondary full" style={{ marginTop: 12 }} onClick={() => setLibreOpen(true)}>
                  + Venta libre
                </button>
                <div className="ticket-total"><span>Total</span><span>${total.toFixed(2)}</span></div>
                <button className="btn full" disabled={ticket.length === 0} onClick={cobrar}>Cobrar</button>
              </div>
            </div>
          </>
        )}
      </main>

      {modalProd && (
        <div className="qty-modal-bg" onClick={(e) => { if (e.target === e.currentTarget) setModalProd(null); }}>
          <div className="qty-modal">
            <h3>{modalProd.nombre}</h3>
            <p className="sub">{modalProd.stock_actual} {modalProd.unidad_medida} disponibles</p>
            <label>Cantidad ({modalProd.unidad_medida})</label>
            <input type="number" min="0" step="any" autoFocus value={qtyVal}
              onChange={(e) => setQtyVal(e.target.value)} style={{ marginBottom: 12 }} />
            <label>Precio {esAdmin ? '(puedes ajustarlo)' : ''}</label>
            <input type="number" min="0" step="0.01" value={precioVal}
              onChange={(e) => setPrecioVal(e.target.value)} readOnly={!esAdmin}
              onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }} />
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

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.text}</div>}
    </div>
  );
}

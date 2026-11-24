import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { getSession } from '../lib/auth';

export async function getServerSideProps({ req }) {
  const session = getSession(req);
  if (!session) return { redirect: { destination: '/login', permanent: false } };
  return { props: { session } };
}

const UNIDADES = ['kg', 'gr', 'lt', 'pza'];

// Para buscar sin que importen mayúsculas ni acentos ("azúcar" = "AZUCAR").
const normalizar = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

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

  // Cobro con teclado: ventana de cobro (pagó con / cambio) y selección de resultados.
  const [cobroOpen, setCobroOpen] = useState(false);
  const [pagoCon, setPagoCon] = useState('');
  const [cobrando, setCobrando] = useState(false);
  const cobrandoRef = useRef(false); // evita cobrar dos veces si se presiona Enter rápido
  const [autoImprimir, setAutoImprimir] = useState(false);
  const [seleccion, setSeleccion] = useState(0);
  const buscadorRef = useRef(null);

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
    setBusqueda('');
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

  // Cantidad legible: máximo 3 decimales, sin ceros sobrantes (0.359, 2, 1.5).
  function fmtCant(n) {
    const x = Number(n);
    if (!isFinite(x)) return String(n);
    return String(parseFloat(x.toFixed(3)));
  }
  // Fecha corta para el ticket: 24/11/2026 09:42 (sin segundos).
  function fmtFechaTicket(f) {
    const d = new Date(f);
    if (isNaN(d.getTime())) return '';
    const p2 = (v) => String(v).padStart(2, '0');
    return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  // Imprime el recibo desde un documento completamente aparte (un iframe
  // invisible), para que la impresión nunca dependa del resto de la
  // página — así no hay forma de que "arrastre" contenido de más ni
  // se quede pidiendo hojas en blanco.
  function imprimirRecibo() {
    const contenido = document.getElementById('recibo-imprimible-contenido');
    if (!contenido) return;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8" />' +
      '<style>' +
      // Esto es lo que evita el papel en blanco de más: le dice a la
      // impresora que el "tamaño de página" es de 80mm de ancho (medida
      // típica de rollo térmico) y de LARGO AUTOMÁTICO — es decir, que
      // corte justo donde termina el contenido, no en una hoja completa.
      '@page{ size:80mm auto; margin:2mm; }' +
      '*{ box-sizing:border-box; }' +
      "html,body{ width:100%; margin:0; padding:0; }" +
      // Tipografía gruesa, negro puro y un poco más grande: las térmicas
      // pierden los trazos delgados, así que todo el ticket va en negritas
      // y con un contorno mínimo que engrosa el trazo sin cambiar el tamaño.
      "body{ font-family:Arial, Helvetica, sans-serif; font-size:14px; font-weight:700; line-height:1.25; color:#000; -webkit-text-stroke:0.35px #000; }" +
      '.recibo-header{ text-align:center; padding-bottom:8px; border-bottom:2px dashed #000; margin-bottom:8px; font-size:13px; }' +
      '.recibo-header .brand{ font-weight:900; font-size:22px; letter-spacing:1px; margin-bottom:4px; display:block; }' +
      '.recibo-header .brand span{ font-weight:900; }' +
      '.recibo-header .fecha{ font-size:13px; margin-top:2px; }' +
      '.recibo-items{ border-bottom:2px dashed #000; padding-bottom:6px; margin-bottom:8px; }' +
      '.recibo-linea{ padding:5px 0; }' +
      '.recibo-nombre{ font-weight:900; font-size:14px; margin-bottom:1px; word-break:break-word; }' +
      '.recibo-detalle{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:13px; }' +
      '.recibo-detalle .sub{ font-weight:900; font-size:14px; white-space:nowrap; }' +
      '.recibo-total{ display:flex; justify-content:space-between; font-size:20px; font-weight:900; padding:4px 0; }' +
      '.recibo-pagos{ padding-top:4px; }' +
      '.recibo-pago{ display:flex; justify-content:space-between; font-size:15px; padding:1px 0; }' +
      '.recibo-metodo{ text-align:center; margin-top:8px; font-size:13px; }' +
      '.recibo-gracias{ text-align:center; margin-top:10px; font-size:13px; }' +
      '</style></head><body>' + contenido.innerHTML + '</body></html>'
    );
    doc.close();

    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Al terminar de imprimir, el teclado regresa a la página (si no, Esc y
      // Enter se quedarían "atrapados" en el documento invisible de impresión).
      try { iframe.blur(); window.focus(); } catch (e) { /* nada */ }
      setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); }, 500);
    };
  }

  function abrirCobro() {
    if (ticket.length === 0 || cobrandoRef.current) return;
    setPagoCon('');
    setCobroOpen(true);
  }

  // Cobra de verdad. Se llama desde la ventana de cobro (Enter o botón).
  // imprimir=true además abre la impresión del ticket de inmediato.
  async function confirmarCobro(imprimir = false) {
    if (cobrandoRef.current || ticket.length === 0) return;

    const totalActual = Math.round(total * 100) / 100;
    let pagoNum = null;
    if (metodoPago === 'efectivo') {
      pagoNum = pagoCon === '' ? totalActual : parseFloat(pagoCon);
      if (!Number.isFinite(pagoNum)) { showToast('Revisa el monto con el que pagó', true); return; }
      if (pagoNum + 0.001 < totalActual) {
        showToast(`Faltan $${(totalActual - pagoNum).toFixed(2)} para completar el pago`, true);
        return;
      }
    }

    cobrandoRef.current = true;
    setCobrando(true);
    try {
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

      const totalVenta = Number(data.venta.total);
      const cambio = pagoNum === null ? null : Math.max(0, Math.round((pagoNum - totalVenta) * 100) / 100);
      setReciboData({
        venta: data.venta, items: ticket, metodoPago, sedeNombre, sedeInfo: inv?.sede || null,
        pagoCon: pagoNum, cambio,
      });
      setCobroOpen(false);
      setReciboOpen(true);
      if (imprimir) setAutoImprimir(true);
      setTicket([]);
      setMetodoPago('efectivo');
      cargarInventario();
      cargarCaja();
      if (data.alertas?.length) {
        showToast(`Venta cobrada. ⚠ Bajo mínimo: ${data.alertas.join(', ')}`, true);
      } else {
        showToast(`Venta cobrada por $${totalVenta.toFixed(2)}`);
      }
    } catch (err) {
      showToast('No se pudo cobrar. Revisa la conexión e inténtalo de nuevo.', true);
    } finally {
      cobrandoRef.current = false;
      setCobrando(false);
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
  // Sin importar mayúsculas ni acentos, y con varias palabras ("chile guaj"):
  // todas las palabras deben aparecer en el nombre o en el código.
  const palabras = normalizar(busqueda).split(/\s+/).filter(Boolean);
  const inventarioFiltrado = !hayBusqueda ? [] : (inv?.inventario || []).filter((p) => {
    const texto = normalizar(p.nombre) + ' ' + normalizar(p.sku_codigo);
    const coincideTexto = palabras.every((w) => texto.includes(w));
    const coincideCategoria = categoriaActiva === 'todas' || p.categoria === categoriaActiva;
    return coincideTexto && coincideCategoria;
  });
  // Solo se pueden elegir con el teclado los que tienen existencia.
  const seleccionables = inventarioFiltrado.filter((p) => Number(p.stock_actual) > 0);
  const seleccionActual = Math.min(seleccion, Math.max(seleccionables.length - 1, 0));
  const productoSeleccionado = seleccionables[seleccionActual] || null;

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

  const totalRedondeado = Math.round(total * 100) / 100;
  const pagoNumVista = pagoCon === '' ? totalRedondeado : parseFloat(pagoCon);
  const cambioVista = Number.isFinite(pagoNumVista) ? Math.round((pagoNumVista - totalRedondeado) * 100) / 100 : null;
  const algunModal = !!modalProd || libreOpen || esperaOpen || corteOpen || retiroOpen || reciboOpen || cobroOpen;

  function enfocarBuscador() {
    const el = buscadorRef.current;
    if (el) { el.focus(); el.select(); }
  }

  // Al elegir otro producto con las flechas, la tarjeta resaltada se mantiene a la vista.
  useEffect(() => { setSeleccion(0); }, [busqueda, categoriaActiva]);
  useEffect(() => {
    const el = document.querySelector('.pos-card-v2.sel');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [seleccionActual, busqueda]);

  // Cuando se cierra cualquier ventana, el cursor regresa al buscador.
  const habiaModal = useRef(false);
  useEffect(() => {
    if (habiaModal.current && !algunModal) enfocarBuscador();
    habiaModal.current = algunModal;
  }, [algunModal]);

  // Imprime solo después de que el ticket ya se dibujó (cobrar e imprimir).
  useEffect(() => {
    if (reciboOpen && autoImprimir) {
      setAutoImprimir(false);
      setTimeout(imprimirRecibo, 150);
    }
  }, [reciboOpen, autoImprimir]);

  // Atajos de teclado:
  //   F2 = ir al buscador · Esc = cobrar (sin ventanas abiertas)
  //   En la ventana de cobro: Enter cobra, Ctrl+Enter cobra e imprime, Esc cancela.
  //   En el ticket: Enter imprime, Esc cierra.
  useEffect(() => {
    function onKey(e) {
      const k = e.key;
      if (k === 'F2' && caja?.abierta && !algunModal) { e.preventDefault(); enfocarBuscador(); return; }

      if (cobroOpen) {
        if (k === 'Escape') { e.preventDefault(); if (!cobrandoRef.current) setCobroOpen(false); return; }
        if (k === 'Enter') { e.preventDefault(); if (!e.repeat) confirmarCobro(e.ctrlKey || e.metaKey); }
        return;
      }
      if (reciboOpen) {
        if (k === 'Escape') { e.preventDefault(); setReciboOpen(false); return; }
        if (k === 'Enter') { e.preventDefault(); if (!e.repeat) imprimirRecibo(); }
        return;
      }
      if (k === 'Escape') {
        if (modalProd) { setModalProd(null); return; }
        if (libreOpen) { setLibreOpen(false); return; }
        if (esperaOpen) { setEsperaOpen(false); return; }
        if (retiroOpen) { setRetiroOpen(false); return; }
        if (corteOpen) return;
        if (notifOpen) { setNotifOpen(false); return; }
        if (tab === 'vender' && caja?.abierta && ticket.length > 0) { e.preventDefault(); abrirCobro(); }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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
                ref={buscadorRef}
                autoFocus
                type="text"
                placeholder="Buscar producto por nombre o SKU..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSeleccion(Math.min(seleccionActual + 1, Math.max(seleccionables.length - 1, 0)));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSeleccion(Math.max(seleccionActual - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (productoSeleccionado) abrirModal(productoSeleccionado);
                  }
                }}
              />
            </div>
            <div className="atajos-bar">
              <span><kbd>↑</kbd><kbd>↓</kbd> elegir</span>
              <span><kbd>Enter</kbd> agregar</span>
              <span><kbd>Esc</kbd> cobrar</span>
              <span><kbd>F2</kbd> buscar</span>
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
                    <div key={p.producto_id}
                      className={`pos-card-v2 ${sinStock ? 'disabled' : ''} ${productoSeleccionado && productoSeleccionado.producto_id === p.producto_id ? 'sel' : ''}`}
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
                <p className="empty-ticket">Busca un producto y presiona Enter para agregarlo</p>
              ) : (
                ticket.map((t, idx) => (
                  <div className="ticket-row-v2" key={idx}>
                    <div>
                      <div className="n">{t.nombre}{t.libre ? ' (libre)' : ''}</div>
                      <div className="q">{fmtCant(t.cantidad)} {t.unidad_medida} × ${Number(t.precio_venta).toFixed(2)}</div>
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
              <button className="btn full" disabled={ticket.length === 0} onClick={abrirCobro}>Cobrar <span style={{ opacity: 0.75, fontWeight: 500 }}>(Esc)</span></button>
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
                  onChange={(e) => setQtyVal(e.target.value)} style={{ marginBottom: 12 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }} />
              </>
            ) : (
              <>
                <label>El cliente quiere pagar ($)</label>
                <input type="number" min="0" step="0.01" autoFocus value={importeVal}
                  onChange={(e) => setImporteVal(e.target.value)} style={{ marginBottom: 6 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } }} />
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

      {cobroOpen && (
        <div className="qty-modal-bg" onClick={(e) => { if (e.target === e.currentTarget && !cobrando) setCobroOpen(false); }}>
          <div className="qty-modal cobro-modal">
            <h3>Cobrar</h3>
            <div className="cobro-label">Total a pagar</div>
            <div className="cobro-total">${totalRedondeado.toFixed(2)}</div>

            <div className="pago-row">
              {['efectivo', 'tarjeta', 'transferencia'].map((m) => (
                <button key={m} type="button" tabIndex={-1} className={`pago-chip ${metodoPago === m ? 'active' : ''}`}
                  onClick={() => setMetodoPago(m)}>
                  {m === 'efectivo' ? '💵 Efectivo' : m === 'tarjeta' ? '💳 Tarjeta' : '🏦 Transferencia'}
                </button>
              ))}
            </div>

            {metodoPago === 'efectivo' ? (
              <>
                <label>Pagó con ($)</label>
                <input
                  autoFocus
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={pagoCon}
                  placeholder={totalRedondeado.toFixed(2)}
                  onChange={(e) => { if (/^\d*\.?\d{0,2}$/.test(e.target.value)) setPagoCon(e.target.value); }}
                  style={{ marginBottom: 10 }}
                />
                <div className="cobro-quick">
                  <button type="button" tabIndex={-1} className="btn small secondary" onClick={() => setPagoCon(totalRedondeado.toFixed(2))}>Exacto</button>
                  {[20, 50, 100, 200, 500, 1000].filter((d) => d >= totalRedondeado).slice(0, 4).map((d) => (
                    <button key={d} type="button" tabIndex={-1} className="btn small secondary" onClick={() => setPagoCon(String(d))}>${d}</button>
                  ))}
                </div>
                <div className={`cobro-cambio ${cambioVista !== null && cambioVista < 0 ? 'falta' : ''}`}>
                  <div className="cobro-label">{cambioVista !== null && cambioVista < 0 ? 'Faltan' : 'Su cambio'}</div>
                  <div className="cobro-cambio-monto">
                    ${cambioVista === null ? '0.00' : Math.abs(cambioVista).toFixed(2)}
                  </div>
                </div>
              </>
            ) : (
              <p className="sub" style={{ textAlign: 'center', margin: '8px 0 18px' }}>
                Se cobra el total completo con {metodoPago}.
              </p>
            )}

            <div className="row">
              <button className="btn secondary" disabled={cobrando} onClick={() => setCobroOpen(false)}>Cancelar (Esc)</button>
              <button className="btn" disabled={cobrando} onClick={() => confirmarCobro(false)}>{cobrando ? 'Cobrando…' : 'Cobrar (Enter)'}</button>
            </div>
            <button className="btn secondary full" style={{ marginTop: 10 }} disabled={cobrando} onClick={() => confirmarCobro(true)}>
              Cobrar e imprimir (Ctrl+Enter)
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
            <div className="recibo-imprimible" id="recibo-imprimible-contenido">
              <div className="recibo-header">
                <div className="brand" style={{ fontSize: 20, justifyContent: 'center' }}>PALA<span>FOX</span></div>
                <div>{reciboData.sedeNombre}</div>
                {reciboData.sedeInfo?.recibo_direccion && <div>{reciboData.sedeInfo.recibo_direccion}</div>}
                {reciboData.sedeInfo?.recibo_telefono && <div>Tel: {reciboData.sedeInfo.recibo_telefono}</div>}
                <div className="mono fecha">{fmtFechaTicket(reciboData.venta.fecha)}</div>
                <div className="mono">Venta #{reciboData.venta.id}</div>
              </div>
              <div className="recibo-items">
                {reciboData.items.map((t, i) => (
                  <div className="recibo-linea" key={i}>
                    <div className="recibo-nombre">{t.nombre}{t.libre ? ' (libre)' : ''}</div>
                    <div className="recibo-detalle">
                      <span>{fmtCant(t.cantidad)} {t.unidad_medida} × ${Number(t.precio_venta).toFixed(2)}</span>
                      <span className="sub">${(t.cantidad * t.precio_venta).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="recibo-total">
                <span>TOTAL</span>
                <span className="mono">${Number(reciboData.venta.total).toFixed(2)}</span>
              </div>
              {reciboData.metodoPago === 'efectivo' && reciboData.pagoCon !== null && reciboData.pagoCon !== undefined && (
                <div className="recibo-pagos">
                  <div className="recibo-pago"><span>Pagó con</span><span className="mono">${Number(reciboData.pagoCon).toFixed(2)}</span></div>
                  <div className="recibo-pago"><span>Cambio</span><span className="mono">${Number(reciboData.cambio || 0).toFixed(2)}</span></div>
                </div>
              )}
              <div className="mono recibo-metodo">
                Pago: {reciboData.metodoPago === 'efectivo' ? 'EFECTIVO' : reciboData.metodoPago === 'tarjeta' ? 'TARJETA' : 'TRANSFERENCIA'}
              </div>
              <div className="recibo-gracias">
                {reciboData.sedeInfo?.recibo_mensaje || '¡Gracias por su compra!'}
              </div>
            </div>
            <div className="row recibo-botones" style={{ marginTop: 18 }}>
              <button className="btn secondary" onClick={() => setReciboOpen(false)}>Cerrar (Esc)</button>
              <button className="btn" onClick={imprimirRecibo}>Imprimir (Enter)</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.text}</div>}
    </div>
  );
}

// Fecha + hora detallada y consistente en todo el sistema: día de la
// semana chico arriba, fecha numérica completa, hora en 12h con AM/PM.
const DIAS = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

export function formatFechaHora(fecha) {
  const d = new Date(fecha);
  return {
    dia: DIAS[d.getDay()],
    fecha: d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true }),
  };
}

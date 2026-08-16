# Punto de Venta Palafox

Proyecto **separado** del sistema de Cristian. Es lo único que ven los
trabajadores de las 3 tiendas: cada quien entra con el usuario y
contraseña de su propia tienda, y solo ve/vende el inventario de esa
tienda. Usa la MISMA base de datos de Aiven que el sistema de Cristian,
así que cada venta se refleja al instante en su panel — sin sincronizar
nada manualmente.

## Cómo funciona el login

No hay selector de tienda en pantalla — el sistema sabe qué tienda es
por el usuario con el que entraste:

| Usuario  | Tienda               | Contraseña (la defines tú) |
|----------|-----------------------|------------------------------|
| tienda1  | Tienda 1 · Centro     | `TIENDA1_PASSWORD`          |
| tienda2  | Tienda 2 · Norte      | `TIENDA2_PASSWORD`          |
| tienda3  | Tienda 3 · Express    | `TIENDA3_PASSWORD`          |

## 1. Instalar dependencias

```bash
npm install
```

## 2. Conectar la misma base de datos de Aiven

```bash
cp .env.example .env.local
```

Abre `.env.local` y pon:
- `DATABASE_URL` → la MISMA que usaste en el proyecto del sistema (mismo Aiven, mismo schema `palafox` — no hace falta correr `db:init` de nuevo aquí, las tablas ya existen).
- `SESSION_SECRET` → cualquier texto largo random (puede ser distinto al del otro proyecto).
- `TIENDA1_PASSWORD`, `TIENDA2_PASSWORD`, `TIENDA3_PASSWORD` → las contraseñas que le vas a dar a cada tienda.

## 3. Correr en local

```bash
npm run dev
```

Abre `http://localhost:3000` — te manda directo al login.

## 4. Subir a Vercel

Repo de GitHub aparte (no el mismo que el sistema de Cristian), importarlo
en Vercel, y agregar las 5 variables de entorno (`DATABASE_URL`,
`SESSION_SECRET`, `TIENDA1_PASSWORD`, `TIENDA2_PASSWORD`,
`TIENDA3_PASSWORD`) en Settings → Environment Variables.

## Modo administrador (Cristian, desde cualquier tienda o desde su casa)

Con usuario `admin` y su propia contraseña (`ADMIN_PASSWORD`), Cristian entra
en un modo especial: puede **elegir a qué tienda conectarse** (no queda fijo
en una sola).

## Catálogo — ahora para todos, no solo admin

Cualquier trabajador (o Cristian) puede, desde la pestaña **Catálogo**:

- Crear productos nuevos.
- Editar nombre, precio y unidad de cualquier producto.
- Dar de baja productos (sin perder el historial de ventas).
- Corregir el stock real de su tienda (para conteos físicos).

Todo esto escribe en la MISMA base de datos que usa el sistema central, así
que se ve reflejado ahí al instante — **y cada cambio queda registrado en la
página "Actividad" del sistema central**, con el nombre de la tienda que lo
hizo, para que Cristian tenga trazabilidad completa aunque no haya sido él
quien lo cambió.

## Punto de venta — funciones de venta real

- **Venta libre**: cualquier trabajador puede cobrar algo que no está en el
  catálogo (botón "+ Venta libre" en el ticket) — se registra con su propio
  nombre, unidad y precio, sin necesidad de darlo de alta primero.
- **Precio ajustable**: se puede cambiar el precio de un producto justo al
  momento de agregarlo al ticket — ese ajuste queda registrado en el
  reporte de ventas, no cambia el precio general del catálogo.

⚠️ Antes de usar estas funciones, asegúrate de haber corrido `npm run db:init`
en el proyecto del sistema central (palafox-inventario) con la versión más
reciente — ahí es donde se crean las tablas/columnas nuevas que usa el punto de venta.

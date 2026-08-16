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

## Catálogo separado por tienda

Cada tienda tiene su propio catálogo, independiente de las demás:

- Un producto que creas desde el POS de Tienda 1 **solo aparece en Tienda 1** — no en Tienda 2 ni Tienda 3. Cristian sí lo ve reflejado en el sistema central de inmediato (tanto en Productos como en Actividad).
- El botón **"Editar"** en cada producto (antes "Corregir stock") ahora abre un panel completo: nombre, unidad, precio, stock y mínimo — todo junto, y un botón para **"Quitar de esta tienda"** sin afectar a las demás.
- Cualquier trabajador (no solo el admin) puede crear productos, editarlos y quitarlos — cada acción queda registrada en la Actividad del sistema central, con el nombre exacto de la tienda que la hizo.

⚠️ Antes de usar estas funciones, corre `npm run db:init` en el proyecto del
sistema central (palafox-inventario) con la versión más reciente.

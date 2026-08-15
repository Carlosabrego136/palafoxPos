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

Vas a terminar con dos links:
- `algo.vercel.app` → el sistema de Cristian
- `otra-cosa.vercel.app` → el punto de venta, el que le compartes a cada tienda

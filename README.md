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

## Sincronización en tiempo real

El punto de venta se refresca solo cada 10 segundos — si Cristian cambia un
precio o corrige el stock desde el sistema central, se ve reflejado aquí sin
que el trabajador tenga que recargar la página.

## Venta completa (Fase 2)

- **Venta por importe**: en el modal de agregar producto, botón "Por importe
  ($)" — el cajero teclea cuánto va a pagar el cliente y el sistema calcula
  la cantidad exacta, sin que nadie tenga que sacar la calculadora.
- **Precio mayoreo**: si el producto tiene precio de mayoreo configurado (se
  hace desde Productos, en el sistema central) y la cantidad lo alcanza,
  aparece un botón para aplicarlo — nunca se aplica solo, el cajero decide.
- **Poner en espera / Retomar**: botón junto a "Venta libre" para pausar un
  ticket a medias (por ejemplo, si llega otro cliente urgente) y un botón
  "En espera (N)" arriba para retomarlo después, incluso si se cerró la
  pestaña.

## Recibo de venta (Fase 5)

Al cobrar, ahora se abre un recibo con el detalle de la venta (productos,
cantidades, precios, total, método de pago) — con botón para **Imprimir**
(usa el diálogo de impresión del navegador, así que funciona con cualquier
impresora de tickets conectada a la compu/tablet) o simplemente cerrar.

## Caja real (Fase 4)

- **Apertura obligatoria**: antes de vender, hay que abrir la caja con el
  fondo inicial (efectivo con el que arranca el día). Sin esto, la pantalla
  de venta no se muestra — es la única forma de que el corte de caja tenga
  sentido después.
- **Retirar / Depositar efectivo**: botones en la barra superior, cada
  movimiento queda registrado con quién, cuánto y por qué.
- **Nuevo Corte / Cerrar caja**: el cajero solo captura el efectivo que
  contó — el sistema calcula y guarda el esperado/diferencia, pero eso
  **no se le muestra al cajero** (corte "a ciegas"). Esa comparación
  (sobrante/faltante) solo la ve Cristian desde **Caja** en el central.
- **Método de pago** al cobrar (Efectivo / Tarjeta / Transferencia) — solo
  las ventas en efectivo cuentan para el corte de caja, para que el cálculo
  sea real.
- **Campanita de notificaciones**: stock bajo y caducidad, en vivo, en la
  barra superior.
- Todo lo anterior lo ve Cristian en tiempo real desde la página **Caja**
  del sistema central — apertura, cortes, y cada retiro/depósito, de las
  3 tiendas juntas.

## Recibo de venta — arreglo de impresión + datos por tienda

- **Arreglado**: el ticket ya no imprime hojas en blanco de más. El
  problema era la técnica usada para aislar el recibo al imprimir (dejaba
  el resto de la pantalla "invisible" pero seguía ocupando espacio en la
  hoja). Ahora el recibo se imprime desde un portal aparte, fuera del
  árbol de la página — solo se imprime el ticket, nada más.
- El recibo ahora puede mostrar **dirección, teléfono y un mensaje de pie
  de página personalizados por tienda** — Cristian los edita desde
  **Ticket** en el sistema central. Si una tienda no tiene nada
  configurado, sale el mensaje genérico de siempre.

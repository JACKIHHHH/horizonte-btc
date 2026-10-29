# Horizonte BTC

Simulador de escenarios de precio de Bitcoin. Agrega precio, derivados, on-chain, liquidez, macro, geopolítica, regulación, noticias, sentimiento social y mercados de predicción; calibra un modelo de probabilidad y publica su precisión histórica. Funciona en el plan gratuito de Cloudflare (Workers, D1, KV y Workers AI).

No da señales de compra o venta: muestra rangos de probabilidad, sus fuentes y su error.

## Qué hay dentro

```
src/model/        Motor (compartido por el navegador y el calibrador)
  garch.ts          GARCH(1,1) con innovaciones t de Student
  engine.ts         Previsión por horizonte, ajuste de volatilidad, Monte Carlo con escenarios
  ridge.ts          Sesgo de dirección (ridge) con filtro de validación
  events.ts         Catálogo de acontecimientos históricos y estudio de eventos
  backtest.ts       Walk-forward: cobertura, CRPS, Brier, PIT y ablación
  pipeline.ts       Elige el modelo de cada horizonte según el backtest
src/worker/       Cloudflare Worker
  connectors/       Una fuente por conector (71 en total), con su licencia
  nlp/              Clasificación, tono, países, agrupación de noticias
  scheduler.ts      Un cron de 5 minutos repartido en 12 turnos por hora
  indices.ts        Índices propios y la instantánea que consume la web
  auth.ts           Cloudflare Access + usuarios asignados
web/              Interfaz (TypeScript + Vite, sin framework)
scripts/          Calibrador diario, mapa, utilidades
migrations/       Esquema de D1
test/             43 pruebas (modelo, conectores, NLP, autenticación)
```

## Despliegue

La forma rápida, desde el Mac: `./desplegar.sh tu@correo.com btc.tudominio.com`. Instala dependencias, abre el inicio de sesión de Cloudflare, crea la base de datos y el KV, rellena `wrangler.toml`, aplica el esquema, genera el token del calibrador, pide las claves opcionales y publica. Se puede repetir sin romper nada.

Paso a paso, si prefieres hacerlo a mano:

Requisitos: Node 20+ y una cuenta de Cloudflare con un dominio propio (necesario para el inicio de sesión).

```bash
npm install
npx wrangler login

# 1. Crear la base de datos y el espacio KV; copiar los ID que devuelven en wrangler.toml
npx wrangler d1 create escenarios-btc
npx wrangler kv namespace create escenarios-btc-kv

# 2. Esquema
npm run db:remote

# 3. Claves (todas gratuitas; las que falten dejan su fuente en "Falta clave")
npx wrangler secret put PUBLISH_TOKEN        # cadena larga aleatoria, la usa el calibrador
npx wrangler secret put FRED_API_KEY         # https://fredaccount.stlouisfed.org/apikeys
npx wrangler secret put COINGECKO_API_KEY    # https://www.coingecko.com/en/api (plan Demo)
npx wrangler secret put CONGRESS_API_KEY     # https://api.congress.gov/sign-up/
npx wrangler secret put CF_RADAR_TOKEN       # Token de API de Cloudflare con permiso "Radar: Read" (licencia no comercial)
npx wrangler secret put GUARDIAN_API_KEY     # https://open-platform.theguardian.com/access/ (no comercial)
npx wrangler secret put REDDIT_CLIENT_ID     # https://www.reddit.com/prefs/apps (opcional)
npx wrangler secret put REDDIT_CLIENT_SECRET

# 4. En wrangler.toml: ADMIN_EMAILS con tu correo y CONTACT_UA con un correo de contacto

# 5. Publicar
npm run deploy
```

Después, en el panel de Cloudflare, asigna el dominio al Worker (Workers → escenarios-btc → Settings → Domains & Routes).

### Primeras horas

- El cron empieza solo. La carga del histórico (precio desde 2014, Fear & Greed, stablecoins, Wikipedia, hashrate, DVOL y 13 series de FRED) avanza un paso cada 5 minutos y tarda unas 2–3 horas. La web muestra el precio y las noticias desde el primer ciclo; el modelo aparece cuando hay suficiente histórico.
- Desde **Cuenta** (como administrador) puedes ver el progreso, ejecutar un ciclo al momento o recargar el histórico (por ejemplo, después de añadir la clave de FRED).

### Calibrador diario

El modelo se calibra en el navegador de cada visitante, pero la previsión oficial (la que se registra y se verifica al vencer) y el backtest semanal los publica un calibrador externo, porque el plan gratuito limita el Worker a 10 ms de CPU. Elige una opción:

- **GitHub Actions** (gratis): sube el proyecto a un repositorio y crea los secrets `BASE` (https://tu-dominio) y `PUBLISH_TOKEN`. El flujo `.github/workflows/calibrar.yml` se ejecuta cada día a las 00:35 UTC y los lunes añade el backtest.
- **NAS**: `nas/docker-compose.yml` hace lo mismo en un contenedor `node:22-alpine` (Portainer → Stacks).
- **A mano**: `BASE=https://tu-dominio PUBLISH_TOKEN=... npm run calibrar:backtest`.

Mientras no haya backtest publicado, la web usa solo la amplitud (sin sesgo de dirección) y lo indica.

## Usuarios

El inicio de sesión lo hace **Cloudflare Access** (gratis hasta 50 usuarios, código de un solo uso por correo, sin contraseñas). Los permisos los asignas en la web, en **Cuenta**.

| Rol | Puede |
| --- | --- |
| Administrador | Asignar y quitar usuarios, cambiar roles, desactivar cuentas, recargar datos y ver la auditoría |
| Analista | Guardar sus propios escenarios en el simulador |
| Lector | Ver la web cuando está en modo privado |

### Modo público (por defecto, `ACCESS_MODE = "publico"`)

Todo el mundo ve la web; solo los usuarios asignados guardan escenarios y los administradores gestionan.

1. Zero Trust → Settings → Authentication: activa **One-time PIN**.
2. Zero Trust → Access → Applications → Add → **Self-hosted**: dominio `tu-dominio`, ruta `entrar`. Política **Allow** con "Emails ending in" o "Everyone" (la autorización real la hace la web). Deja desactivado *Cookie Path Attribute* para que la sesión valga en todo el dominio.
3. Copia el **Application Audience (AUD) Tag** y el nombre de tu equipo (`<equipo>.cloudflareaccess.com`) en `ACCESS_AUD` y `ACCESS_TEAM` de `wrangler.toml` y vuelve a desplegar.

El botón **Entrar** lleva a `/entrar`; Access pide el código y te devuelve a la web identificado.

### Modo privado (`ACCESS_MODE = "privado"`)

Solo los usuarios asignados ven datos. Crea la aplicación de Access para el **dominio completo** (ruta vacía) y, en la política, permite los correos que vayas a asignar. Aunque alguien pase Access, la API solo responde si su correo está asignado y activo en la web.

### Seguridad

- El Worker verifica la firma RS256 del token de Access, la audiencia, el emisor y la caducidad.
- Las operaciones de escritura exigen el mismo origen; ningún administrador puede quitarse su propio rol.
- Todos los cambios de usuarios quedan en la auditoría.
- `DEV_USER` (solo en `.dev.vars`) se ignora fuera de `localhost`.

## Fuentes y licencias

La página **Fuentes** muestra, en vivo, el estado de cada conector y su licencia: *Apta*, *Verificar* (gratuita pero conviene leer sus términos antes de poner publicidad) o *No comercial*. Las no comerciales (Coin Metrics, Guardian, Cloudflare Radar) quedan desactivadas mientras `NONCOMMERCIAL_SOURCES = "off"`. Si la web no lleva publicidad y quieres usarlas, pon `"on"`.

## Desarrollo local

```bash
npm run db:local
printf 'DEV_USER=tu@correo\nADMIN_EMAILS=tu@correo\nPUBLISH_TOKEN=local\n' > .dev.vars
npm run build && npx wrangler dev --test-scheduled
npm test
```

## Límites conocidos

- **CPU en el plan gratuito**: cada ejecución tiene 10 ms de CPU (con cierta tolerancia). El trabajo está repartido en turnos para no superarlo, pero algunas respuestas grandes (opciones de Deribit, Polymarket) se acercan al límite. Si en Workers → Metrics aparece *Exceeded CPU*, el plan Workers Paid (5 US$/mes) lo elimina; no hace falta cambiar código.
- **Regiones**: Binance y Bybit no responden a peticiones desde algunas regiones de EE. UU.; el precio de referencia sigue funcionando con el resto.
- **Dirección**: en el backtest con datos reales, ningún conjunto de variables mejoró de forma estable al paseo aleatorio en la dirección a 30 y 90 días. La web lo muestra y usa la referencia ingenua en esos horizontes hasta que el backtest diga lo contrario.
- **Índices vivos** (geopolítica, regulación): solo amplían la volatilidad con pesos provisionales. El calibrador puede estimarlos cuando haya 120 días de histórico propio en `index_log`.

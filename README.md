# Parental Coordination Backend

Backend API del **Sistema de Coordinación Parental** — una plataforma para la gestión coparental en entornos de alta conflictividad.

## Stack

- **NestJS** 10
- **TypeORM** 0.3 con **PostgreSQL**
- **JWT + bcryptjs** para autenticación
- **Swagger** para documentación de API

## Setup

Requiere **Node 22** (`nvm use` lee el `.nvmrc`). No es opcional: `@supabase/supabase-js`
construye su cliente de Realtime dentro de `createClient()` y tira en Node 20, que
no tiene `WebSocket` global. `StorageService` envuelve esa llamada en un `try/catch`,
así que el síntoma no es un crash sino `400 Storage not configured` en cada presign
de adjunto.

```bash
# 1. Instalar dependencias
pnpm install

# 2. Configurar variables de entorno
cp .env.example .env
# editar .env con tus credenciales de DB y JWT

# 3. Crear la base de datos
createdb parental_coordination

# 4. Ejecutar migraciones
# (el script typeorm ya incluye -d src/database/data-source.ts)
pnpm typeorm migration:run

# 5. Iniciar en desarrollo
pnpm start:dev
```

> Para Supabase Cloud no hace falta `createdb`: ver
> [Supabase Cloud](#supabase-cloud-postgres--storage). El resto del flujo (env,
> migraciones, arranque) es el mismo.

## Redis local (timers)

Los timers de activities usan Redis + BullMQ. Para levantar sólo la
infraestructura local:

```bash
docker compose up -d postgres redis
docker compose ps           # verificar que los contenedores están healthy
```

Variables de entorno (ver `.env.example`, todas opcionales con defaults):

- `REDIS_HOST` (default `localhost`)
- `REDIS_PORT` (default `6379`)
- `REDIS_PASSWORD` (vacío por defecto)
- `REDIS_DB` (default `0`)
- `REDIS_TLS` (`true`|`false`, default `false`)

> ⚠️ **Pin de peers**: NO subir `bullmq` a v6 ni `@nestjs/bullmq` a v11.
> Ambos exigen `@nestjs/core ^11` y rompen el peer de Nest 10. Mantener
> `bullmq@^5.81.5` + `@nestjs/bullmq@^10.2.3` + `ioredis@^5.11.1`.

## Entornos: dev local, prod en Supabase Cloud

Producción es **Supabase Cloud**. Desarrollo es **docker compose**, en tu
máquina. No hay un tercer entorno y k8s queda fuera por ahora.

| | Dónde corre la API | Base | Redis | Bucket |
| --- | --- | --- | --- | --- |
| **dev** | `pnpm start:dev` en tu máquina | `docker compose postgres` | `docker compose redis` | `activity-attachments-dev` + `reports-dev` |
| **prod** | donde deployes (`node dist/src/main`) | Supabase Cloud (pooler de sesión) | el que uses | `activity-attachments` + `reports` |

Son **dos** buckets por entorno: los adjuntos de actividad/gasto y los PDF de
reporte. `SUPABASE_STORAGE_BUCKET_REPORTS` es el segundo; si falta, el servicio cae
al nombre `reports` y la subida apunta a un bucket que nadie creó.

Los dos archivos de entorno:

- **`.env`** → dev. `DB_HOST=127.0.0.1`, `DB_SSL=false`, buckets `-dev`.
- **`.env.prod`** → prod. Pooler de Supavisor, `DB_SSL=true`, buckets
  `activity-attachments` y `reports`.

Los dos están gitignoreados. `.env.example` es el único archivo versionado.

### Regla que evita el accidente

**`git push` no toca Supabase.** No hay CI en este repo. La base cloud cambia
sólo cuando alguien corre una migración a mano o cuando un proceso vivo conectado
a ella escribe filas. Por eso dev y prod se separan en el archivo, no en la
memoria de quien escribe el comando.

### Dev

```bash
docker compose up -d postgres redis
pnpm typeorm migration:run     # .env -> localhost
pnpm start:dev
```

### Prod

```bash
pnpm typeorm:prod              # ENV_FILE=.env.prod migration:run
pnpm storage:init:prod         # ENV_FILE=.env.prod, ambos buckets
```

Las dos son idempotentes: `migration:run` responde "No migrations are pending"
si no hay nada nuevo, y el bootstrap del bucket converge al límite declarado.

### Crear el primer admin

No hay script de seed: `scripts/seed-admin.ts` se eliminó porque creaba
`admin@admin.com` / `admin123` hardcodeados, y ese literal terminó siendo una
credencial real en producción. El camino es registrar por la API y promover el
rol, que es lo único que la API no expone:

```bash
curl -X POST https://<api>/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"vos@mail.com","password":"<fuerte>","firstName":"...","lastName":"..."}'

# con las credenciales de .env.prod
psql "$DB_URL" -c "UPDATE \"user\" SET system_role = 'admin' WHERE email = 'vos@mail.com';"
```

El smoke e2e no depende de ese seed: crea su propio admin (`smoke-admin-<ts>@test.dev`)
en `beforeAll` y le cambia el rol por SQL.

## Supabase Cloud (Postgres + Storage)

Un solo proyecto de Supabase Cloud es dueño de la base y del bucket de adjuntos.
El backend NestJS y el worker siguen igual: no hay Auth ni Realtime de Supabase
en juego. Dev y prod **comparten el proyecto** (y por lo tanto la service-role
key), pero no la base ni el bucket: dev usa `docker compose postgres` y
`activity-attachments-dev`. Aislamiento real del todo requiere un segundo
proyecto de Supabase.

### 1. Proyecto

Crear un proyecto en Supabase y tomar de **Project Settings**:

- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (API)
- host, puerto, usuario y contraseña de la base (Database)

### 2. Variables

```bash
cp .env.example .env        # dev
cp .env.example .env.prod   # prod, y completar con los valores de la nube
```

- **Todo el proceso** (API, worker, migraciones, seed): pooler de Supavisor en
  **modo sesión**, puerto `5432`, usuario `postgres.<project-ref>`,
  `DB_SSL=true`.
- No uses el puerto `6543` (modo transacción): TypeORM prepara sentencias y el
  pooler transaccional las rompe.
- La conexión directa `db.<project-ref>.supabase.co:5432` existe, pero es
  **solo IPv6**: en una máquina sin IPv6 (esta, por ejemplo) no resuelve ni
  conecta. El modo sesión acepta DDL, así que alcanza para migrar.

Si hay datos locales que conservar:

```bash
pg_dump -h localhost -U parental -d parental_coordination \
  --no-owner --no-privileges -Fc -f parental.dump
pg_restore --no-owner --no-privileges \
  -d "postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" \
  parental.dump
```

Si no hay datos que conservar, alcanza con correr las migraciones sobre la base
vacía:

```bash
DB_SSL=true pnpm typeorm migration:run
```

### 3. Bucket

```bash
pnpm storage:init
```

Crea o ajusta **los dos** buckets privados con el límite de tamaño y los MIME
types `image/jpeg`, `image/png`, `application/pdf`:

- `SUPABASE_STORAGE_BUCKET_ACTIVITY_ATTACHMENTS` (adjuntos)
- `SUPABASE_STORAGE_BUCKET_REPORTS` (PDF de reportes)

Es idempotente y reemplaza al viejo servicio `supabase-init`. En Docker los dos
nombres llegan por `docker-compose.yml`, pero los buckets siguen viviendo en
Supabase Cloud: este script es el que los crea.

### 4. Verificar

- `GET /api/health`
- Un presign de adjunto devuelve una URL absoluta de
  `<project-ref>.supabase.co`, así que el cliente móvil ya no necesita
  `adb reverse`.
- `act_attachment.file_url` sigue guardando el path del objeto, no la URL.

### Emulador de Android

Las URLs firmadas son absolutas y apuntan a la nube: el
`adb reverse tcp:54321 tcp:54321` que hacía falta con el stack local ya no
aplica. Cualquier dispositivo con red puede subir y descargar.

### k8s

Los manifiestos de `k8s/` siguen apuntando a un Postgres dentro del clúster
(`k8s/app-configmap.yaml`, `k8s/postgres-statefulset.yaml`). Para usar Supabase
Cloud hay que cambiar `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_SSL` y el secreto de la
base, y retirar el StatefulSet. Eso no está hecho en este cambio.

> ⚠️ Plan free: el proyecto se pausa tras ~1 semana sin actividad y no tiene
> backups. Para producción hace falta Pro.

## API en un host administrado (Render)

Supabase guarda los datos (Postgres + Storage), pero no ejecuta la API: no es un
host de Node y sus Edge Functions no mantienen procesos vivos. Vercel tampoco
sirve para este backend: `docker-compose.yml` define `api` **y** `worker`
(BullMQ) más Redis, y el gateway WebSocket de `/realtime` necesita conexiones
largas. Vercel no tiene workers ni WebSocket persistente.

`render.yaml` describe el despliegue completo: dos procesos de la misma imagen
más un Key Value privado.

| Servicio | Comando | Rol |
| -------- | ------- | --- |
| `parental-api` | CMD de la imagen (`dist/src/main.js`) | HTTP + WebSocket `/realtime` |
| `parental-worker` | `node dist/src/worker.main.js` | outbox, webhooks, fan-out |
| `parental-redis` | — | colas BullMQ (`noeviction`) |

### Pasos

1. Render Dashboard → **New** → **Blueprint** → elegir el repo. El dashboard
   valida `render.yaml` antes de crear nada.
2. Al aplicar pide los valores marcados `sync: false`. Salen de `.env.prod`:
   `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. `JWT_SECRET` se genera solo y el
   worker lo hereda del servicio web.
3. Las migraciones corren en `preDeployCommand` contra Supabase, antes de que la
   instancia nueva reciba tráfico.
4. Verificar `https://<servicio>.onrender.com/api/health` y después el login real.

### Detalles que rompen si se cambian

- **Redis interno es `redis://`, sin TLS.** Solo el acceso externo usa TLS; forzar
  `REDIS_TLS=true` contra el puerto interno falla el handshake.
- **`maxmemoryPolicy: noeviction` es obligatorio.** Con una política de evicción
  BullMQ pierde jobs encolados en silencio.
- **`REDIS_TLS` y `REDIS_PASSWORD` quedan vacíos**: el Key Value interno de Render
  no pide auth.
- **Dos servicios, una imagen.** El worker no escucha puerto; su salud es el
  proceso vivo, como en `docker-compose.yml`.

### Servicio único: qué falta y por qué

Si `parental-coord-back` se creó a mano (no desde `render.yaml`), la API responde
pero **Redis y el worker no existen**, y eso se ve en los logs como:

```
[ioredis] Unhandled error event: AggregateError [ECONNREFUSED]
```

`src/queues/redis.config.ts` cae en `REDIS_HOST ?? 'localhost'`: dentro del
contenedor no hay nada escuchando en 6379, e ioredis reintenta para siempre
(`maxRetriesPerRequest: null`) sin tumbar el proceso. Resultado: HTTP y login
funcionan, y **outbox, notificaciones y webhooks no se procesan**. Las filas se
acumulan en `outbox_event` sin consumidor.

Alta manual, en este orden:

1. **Key Value** — Dashboard → New → Key Value. Misma región que el web service
   (la red privada no cruza regiones), plan free y **Maxmemory policy:
   `noeviction`** (con evicción, BullMQ pierde jobs en silencio). Copiar la
   *Internal Redis URL*: `redis://red-xxxx:6379`.
2. **Web service** — agregar `REDIS_HOST=red-xxxx` y `REDIS_PORT=6379`. **No**
   definir `REDIS_TLS` (interno es `redis://` pelado). Save, rebuild and deploy.
3. **Worker** — Dashboard → New → Background Worker, mismo repo y región,
   runtime Docker con el mismo `./Dockerfile`, y comando:
   `node dist/src/worker.main.js`. Mismas variables que la API, con el **mismo
   `JWT_SECRET`** (es obligatorio para `validateConfig`).

Para no duplicar variables entre los dos procesos, cargalas en un **Environment
Group** (`parental-shared`), enlazado a la API y al worker.

Las migraciones ya están aplicadas contra Supabase (16/16). Si hiciera falta
correrlas de nuevo: `node node_modules/typeorm/cli.js migration:run -d dist/src/database/data-source.js`
desde la Shell del servicio.

### Apuntar el APK a la API

La URL no está clavada en el código: `shared/build.gradle.kts` la inyecta como
`BuildConfig.API_BASE_URL` / `BuildConfig.WS_URL`, con `-PapiBaseUrl` y `-PwsUrl`
como override. Por defecto apunta al host administrado (`https`/`wss`).

```bash
# APK contra producción (el default, no hace falta pasar nada)
./gradlew :androidApp:assembleDebug

# APK contra el backend local de esta máquina
./gradlew :androidApp:assembleDebug \
  -PapiBaseUrl=http://192.168.0.17:3000/api \
  -PwsUrl=ws://192.168.0.17:3000/realtime
```

Una IP LAN solo sirve en la misma red y no viaja en un APK instalado en otro
teléfono: por eso dejó de ser el valor por defecto. El cleartext HTTP del
override local lo sigue habilitando
`androidApp/src/androidMain/res/xml/network_security_config.xml`.

> ⚠️ El primer admin se crea a mano (ver "Crear el primer admin"): ya no existe
> script de seed, y `POST /api/auth/register` sólo crea progenitores.

## Endpoints

- `POST /api/auth/register` — Registrar usuario progenitor
- `POST /api/auth/login` — Login → JWT token
- `GET /api/auth/me` — Perfil del usuario autenticado (requiere Bearer token)
- `GET /docs` — Documentación Swagger

## Base de datos (ERD revisado)

```
user (1:1) personal_data
user (N:N) bond via bond_member (rol progenitor/coordinador)
bond (1:N) children / expense / auth_third_party / report / activity / notification / audit_log
activity (N:N) children via activity_child
activity (1:N) act_attachment
expense (1:N) expense_attachment
auth_third_party (1:N) third_activity_participation
audit_log = bitácora inmutable (append-only)
```

Ver `/home/angelo/ERD_REVISADO.md` para el detalle completo del esquema.

## Scripts

- `pnpm build` — compilar
- `pnpm start:dev` — desarrollo con watch
- `pnpm typeorm migration:generate -d src/database/data-source.ts` — generar migración desde entidades
- `pnpm typeorm migration:run` — aplicar migraciones (el script ya incluye `-d src/database/data-source.ts`)
- `pnpm lint` / `pnpm test` — calidad y tests

## Estructura

```
src/
  auth/               # register, login, JWT
  users/              # entidades user + personal_data
  bonds/              # bond + bond_member
  children/           # children
  activities/         # activity, activity_child, act_attachment
  expenses/           # expense, expense_attachment, auth_third_party, participation
  reports/            # report (judicial)
  notifications/      # notification
  audit/              # audit_log
  common/             # guards, strategies, decorators
  config/             # validación de env
  database/migrations # migraciones SQL
```

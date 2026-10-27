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

## Redis local (timers)

Los timers de activities usan Redis + BullMQ. Para levantar un Redis de desarrollo:

```bash
docker compose up -d        # redis:7-alpine con AOF en localhost:6379
docker compose ps           # verificar que el contenedor está healthy
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

## Supabase Storage local (adjuntos de actividades)

El backend firma URLs de subida contra Supabase Storage y el cliente móvil hace
el `PUT` directo contra esa URL. Para probarlo sin depender de la nube hay un
stack local mínimo, colgado de un profile de compose para que
`docker compose up -d` siga levantando exactamente lo mismo que antes:

```bash
docker compose --profile storage up -d
docker compose --profile storage ps   # esperar healthy en db/storage/gateway
```

Levanta cinco servicios: `supabase-db` (imagen `supabase/postgres`, puerto
`54322`), `supabase-rest` (PostgREST, dependencia de arranque de storage-api),
`supabase-storage` (`STORAGE_BACKEND=file`, sin S3 ni MinIO), `supabase-gateway`
(Caddy en `54321`) y `supabase-init`, que crea el bucket `activity-attachments`
de forma idempotente.

No están Studio, GoTrue, Realtime, Edge Runtime ni el pooler: no participan del
flujo `presign -> PUT -> confirm`.

Variables en `.env` (las mismas que lee la API, así la service-role key no puede
desincronizarse entre los dos lados):

- `SUPABASE_URL` — default `http://localhost:54321`
- `SUPABASE_JWT_SECRET` — HS256 con el que storage-api valida los tokens
- `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — firmadas con ese secreto
- `SUPABASE_STORAGE_BUCKET_ACTIVITY_ATTACHMENTS` — default `activity-attachments`
- `ATTACHMENTS_MAX_SIZE_BYTES` — default `10485760`

> ⚠️ El secreto y las keys de `.env.example` son **sólo para desarrollo local**
> y están commiteadas a propósito para que un clone nuevo arranque sin generar
> JWTs. Cualquiera con ese secreto puede firmar un token `service_role`.

### Emulador de Android

`createSignedUploadUrl` devuelve una URL absoluta construida a partir del
`SUPABASE_URL` **del backend**, y el emulador hace el `PUT` contra ella. Ese
mismo valor lo usa el backend para sus propias llamadas (list, signed download,
delete), así que no puede ser `10.0.2.2` (el host no lo resuelve) ni dejar de
serlo (el emulador no alcanza el `localhost` del host).

La salida es redirigir el `localhost` del dispositivo al del host:

```bash
adb reverse tcp:54321 tcp:54321
```

Los dos lados usan `http://localhost:54321` y no hay que tocar código. Lo mismo
aplica al `viewUrl` de descarga, que se abre en el navegador del dispositivo.

### Verificar el stack

```bash
curl -s http://localhost:54321/storage/v1/status          # gateway -> storage
docker compose --profile storage exec supabase-db \
  psql -U postgres -d postgres -c "select id, name from storage.buckets;"
```

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

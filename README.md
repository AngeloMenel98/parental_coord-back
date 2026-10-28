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

## Supabase Cloud (Postgres + Storage)

Un solo proyecto de Supabase Cloud es dueño de la base y del bucket de adjuntos.
El backend NestJS y el worker siguen igual: no hay Auth ni Realtime de Supabase
en juego.

### 1. Proyecto

Crear un proyecto en Supabase y tomar de **Project Settings**:

- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (API)
- host, puerto, usuario y contraseña de la base (Database)

### 2. Variables

```bash
cp .env.example .env
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

Crea o ajusta el bucket privado `activity-attachments` con el límite de tamaño y
los MIME types `image/jpeg`, `image/png`, `application/pdf`. Es idempotente y
reemplaza al viejo servicio `supabase-init`.

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

# Parental Coordination Backend

Backend API del **Sistema de Coordinación Parental** — una plataforma para la gestión coparental en entornos de alta conflictividad.

## Stack

- **NestJS** 10
- **TypeORM** 0.3 con **PostgreSQL**
- **JWT + bcryptjs** para autenticación
- **Swagger** para documentación de API

## Setup

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

# Supabase Cloud Postgres + Storage

Objective: move the app database and activity-attachment storage to one Supabase
Cloud project and remove the local self-hosted Supabase stack.
Branch: `ft/supabase-cloud` (from `ft/notification-read`). Delivery: single PR.
Test runner: `pnpm test` (jest) + `pnpm build` + `docker compose config`.

## Specs

S1 — **Cloud Postgres.** The API and worker connect to Supabase Cloud Postgres
with SSL enabled. Runtime connections use the Supavisor pooler; TypeORM
migrations use the direct connection. No schema rewrite: the 13 existing
migrations must apply unchanged.

S2 — **Cloud Storage.** Activity attachments keep the existing
`presign -> PUT -> confirm` flow, now against Supabase Cloud Storage. The bucket
is private, created idempotently, with the current limits
(`image/jpeg`, `image/png`, `application/pdf`, `ATTACHMENTS_MAX_SIZE_BYTES`).
`act_attachment.file_url` keeps storing the object path, not a full URL.

S3 — **Delete the local Supabase stack.** Remove from `docker-compose.yml`:
`supabase-db`, `supabase-rest`, `supabase-storage`, `supabase-gateway`,
`supabase-init`, and the `supabase-db-data` / `storage-data` volumes. Delete
`docker/supabase/` (Caddyfile, `init/99-roles.sql`). Remove the dev-only
`SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY` and `SUPABASE_DEV_DB_PASSWORD` from
`.env.example`. Keep `StorageService`, `@supabase/supabase-js`, and the bucket /
max-size settings. The app's own `postgres` and `redis` compose services stay for
local development.

S4 — **Notifications untouched.** The WebSocket gateway, Redis pub/sub and
BullMQ notification fan-out/retention are out of scope and must not change. The
user's exact request: "delete everything of supabase that we did so
parental-coordination notification could work" — verified premise: no Supabase
code is in the notification path, so deleting the storage stack cannot affect it.

S5 — **Repeatable bucket bootstrap.** Replace the one-shot `supabase-init`
container with `scripts/create-storage-bucket.ts` (`pnpm storage:init`),
idempotent against a cloud project, using `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY`.

S6 — **Runbook.** README documents: project creation, env values, pooler vs
direct ports, migration run, bucket bootstrap, data dump/restore, and the fact
that cloud signed URLs are absolute (the Android `adb reverse` step disappears).
Record that k8s still runs an in-cluster Postgres and what must change to point
it at Supabase.

Out of scope: Supabase Auth, Supabase Realtime, Edge Functions, RLS policies,
rewriting k8s manifests, deleting existing Docker volumes, pushing or opening a
PR.

## Tasks

| ID  | Specs    | Route | Status  | Commit |
| --- | -------- | ----- | ------- | ------ |
| T1  | S3       | inline | done    | 9b3715d |
| T2  | S1, S2, S5 | inline | done  | c65c7a5 |
| T3  | S6       | inline | done    | este commit |
| T4  | all      | inline | pending (needs cloud credentials) | — |

## Log

L1 (verbatim): "could you help me move the backend to supabase? also delete everything of supabase that we did so parental-coordination notification could work."

L2 (verbatim): "i meatn the storage, but what do you recommend according to the db?"

L3 (verbatim): "do the cloud Postgres _ storage in supabase and delete local stack"

L4 — Evidence gathered before writing: the only Supabase footprint is the local
storage profile (5 compose services), `docker/supabase/*`, `StorageService`, and
`DB_SSL` support. Notifications use Nest WebSocket + Redis; neither repo has
Supabase Realtime/Auth code. `act_attachment.file_url` stores a path; presign
returns an absolute URL built from `SUPABASE_URL`. Migrations are plain SQL using
core `gen_random_uuid()`, no extensions, no RLS, no PostgREST dependency.

L5 — T1/T2/T3 done. Compose keeps `postgres`, `redis`, `migrate`, `api`,
`worker`; the five Supabase services and both storage volumes are gone, and
`docker/supabase/` is deleted. `api`/`worker` now receive `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, bucket and max-size from the project `.env`
(previously they received none, so attachments were always disabled in Docker).
`.env.example` documents the pooler/direct split and drops the committed dev
keys. `scripts/create-storage-bucket.ts` (`pnpm storage:init`) replaces
`supabase-init` and converges an existing bucket. README carries the cloud
runbook plus the k8s caveat.

L6 — Verification observed: `pnpm build` OK; `pnpm test` 70 suites / 759 tests
passed; `docker compose config --quiet` OK; eslint + prettier on the new script
OK; `storage:init` against an unreachable URL exits 1 with a clear message and no
stack trace (Node 22 path). Test-first exception: the change is configuration
deletion plus docs, there is no runnable behavior to pin in RED, and `scripts/`
is outside jest's `rootDir`. Not verified: the real cloud cutover (project
creation, `pg_dump`/`pg_restore`, `migration:run`, bucket creation) — no Supabase
credentials were available.

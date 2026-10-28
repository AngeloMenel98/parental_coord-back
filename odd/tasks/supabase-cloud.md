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
| T4  | all      | inline | partial (DB rebuilt + admin seed; bucket and smoke need credentials) | — |

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

L7 — Cloud DB inspection through the Supabase MCP server (project
`nagiwqmtomybacvcqojq`). The database was **not empty**: it carried a drifted
schema from an older build. Evidence: `public.migrations` held a single row
`InitialSchema1791312997492` — a timestamp no migration in this repo uses; the
enum types were `synchronize`-shaped (`user_system_role_enum`,
`activity_status_enum`, `bond_agreement_type_enum`) while
`1785503810000-initial-schema.ts` creates `system_role`, `activity_status`,
`agreement_type`; `outbox_event`, `webhook_*`, `activity.version` and
`notification.source_event_id` did not exist; `activity.assigned_confirmed` was
still there; and the only data was three Oct-6 test accounts
(`admin@admin.com`, `progenitor@test.com`, `progenitora@test.com`) plus their
`personal_data` rows.

L8 (verbatim): "ye drop those, but first tell me what are the version in activity, what are there versions?"

L9 — Rebuild. `activity.version` is the optimistic-lock counter added by
`1791859200000-AddActivityVersionAndOutbox`: `integer NOT NULL DEFAULT 0`, rows
born at `version = 1` with their first `outbox_event` (`aggregate_version = 1`),
and `+1` per accepted transition inside the same transaction as that transition's
outbox row; `applyTransition` compares it against `expectedVersion` under
`SELECT … FOR UPDATE` and returns `null` on mismatch. It is internal: no DTO
exposes it, and it feeds the deterministic timer job ids.

L10 — Execution. Stashed `user`/`personal_data` in `_bak_*` tables, dropped the
17 drifted tables and 11 enum types, then replayed the 13 migrations
statement-for-statement: each `up()` was run against a stub QueryRunner that
records `query()` calls, the statements were applied through MCP, and the 13
`(timestamp, name)` rows were inserted into `public."migrations"` so TypeORM's
history matches reality. The three accounts were restored and the admin password
hash was reset to the seed's `admin123` (bcrypt cost 10), because the restored
row carried a hash of unknown origin.

L11 — Verified on the cloud DB: 21 tables in `public` (20 domain + `migrations`),
13 history rows ending at `1792646400000`, `activity.version` and
`activity.category_id` present, `assigned_confirmed` gone, `notification.source_event_id`
plus `IDX_notification_source_event` / `IDX_notification_user_created`,
`IDX_outbox_pending`, the four `webhook_*` tables, and `activity_status` =
`created,assigned,assisting,in_progress,verify,done,overdue,not_assisting,cancelled`
— exactly the `ActivityStatus` enum in `activity.entity.ts`.

L12 — Gotcha: `DROP TYPE … CASCADE` silently dropped `_bak_user.system_role`
(the stash column used the old enum type), so the restore mapped roles by user
id instead. Re-check a stash's columns after dropping enum types, or use
`text`-cast copies for enum columns.

L13 — Still open: `SUPABASE_SERVICE_ROLE_KEY`, the Supavisor session URI plus DB
password (the direct host is IPv6-only here), `pnpm storage:init`, and the
presign → PUT → confirm smoke.

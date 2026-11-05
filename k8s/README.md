# Parental Coordination Back — local Postgres + app on minikube

The app (and the e2e suites) need a live Postgres. These manifests run
`postgres:16-alpine` on a local minikube cluster with the same credentials as
the project `.env` (`parental` / `parental_secret` / `parental_coordination`),
plus a `parental_coordination_test` database for e2e. The async plane — BullMQ
webhook deliveries, activity timers, notification fan-out/retention and the
realtime publisher — additionally needs Redis, so this setup also runs
`redis:7-alpine` in-cluster.

The app backend is deployed as a Deployment with envFrom referencing the
in-cluster Postgres at `postgres:5432` and Redis at `redis:6379`. A second
Deployment (same image, `node dist/src/worker.main.js`) runs the queue
consumers; without it the outbox is never drained and no notification is ever
written (release gate W3).

> `kubectl` is NOT on PATH in this project — use `minikube kubectl -- <cmd>`
> (or `alias kubectl='minikube kubectl --'` in a single shell session).

## 1. Start the cluster

```bash
minikube start --driver=docker
```

First start pulls the minikube base image — allow a few minutes.

## 2. Build the Docker image inside minikube

```bash
# Point Docker to minikube's daemon so the image is available inside the cluster:
eval $(minikube docker-env)

# Build the app image (uses the multi-stage Dockerfile or simple build):
docker build -t parental-coordination-back:latest .

# After building, you can restore your local Docker daemon:
# eval $(minikube docker-env -u)
```

> If you don't have a Dockerfile yet, you can build manually:
> ```bash
> pnpm install && pnpm build
> docker build -t parental-coordination-back:latest --build-arg DIST_DIR=dist .
> ```
> Or create a simple Dockerfile first.

## 3. Apply the manifests

Apply the data stores first, wait for them, then the app and the worker. A
single `apply -f k8s/` also converges (pods restart until their dependencies
exist), but the two-phase order avoids a noisy first rollout.

```bash
# Phase 1 — data stores + config/secret
minikube kubectl -- apply -f k8s/postgres-secret.yaml -f k8s/postgres-configmap.yaml \
  -f k8s/postgres-pvc.yaml -f k8s/postgres-service.yaml -f k8s/postgres-statefulset.yaml \
  -f k8s/redis-pvc.yaml -f k8s/redis-service.yaml -f k8s/redis-statefulset.yaml \
  -f k8s/app-configmap.yaml -f k8s/app-secret.yaml

minikube kubectl -- rollout status statefulset/postgres --timeout=180s
minikube kubectl -- rollout status statefulset/redis --timeout=180s

# Phase 2 — API, worker, policies, ingress
minikube kubectl -- apply -f k8s/
```

Phase 1 creates: `postgres-secret` (Secret), `postgres-initdb` (ConfigMap with
`10-create-test-db.sql`), `postgres` (headless Service), `postgres-data` (PVC
5Gi, storageClass `standard`), `postgres` (StatefulSet, 1 replica),
`redis-data` (PVC 1Gi), `redis` (ClusterIP Service), `redis` (StatefulSet,
1 replica), `app-config` (ConfigMap), `app-secret` (Secret).

Phase 2 adds: `parental-coordination-back` (Deployment), `parental-coordination-back`
(NodePort Service), `parental-coordination-worker` (Deployment), the
`NetworkPolicy` set and the ingress/HPA/PDB.

## 4. Wait until Postgres and Redis are Ready

```bash
# Blocks until the pods are Ready (pg_isready / redis-cli ping pass) or times out:
minikube kubectl -- rollout status statefulset/postgres --timeout=180s
minikube kubectl -- rollout status statefulset/redis --timeout=180s

# Or watch the pods directly:
minikube kubectl -- get pods -w
```

## 5. Verify the databases (in-cluster)

```bash
minikube kubectl -- exec postgres-0 -- psql -U parental -lqt | grep parental_coordination_test
```

You should see `parental_coordination_test` (created by the initdb ConfigMap on
first boot). `parental_coordination` is created by the image from the Secret's
`POSTGRES_DB`.

**Fallback** if the test DB is missing (e.g. the initdb hook never ran):

```bash
minikube kubectl -- exec postgres-0 -- psql -U parental -d postgres -c "CREATE DATABASE parental_coordination_test"
```

## 6. Migrations

In-cluster migrations are automatic: the API Deployment's `migrations`
initContainer runs `node node_modules/typeorm/cli.js migration:run -d
dist/src/database/data-source.js` before the app container starts, so every
`kubectl apply` of a new image applies pending migrations once. The worker does
NOT run migrations — it waits for the API's initContainer to finish (on a first
rollout it may restart a few times until the schema exists; that is expected).

The commands below are only for a DB reached from your machine (`.env`) or for
the e2e test database:

```bash
# Apply pending migrations to the dev DB (.env):
pnpm typeorm migration:run

# For the test DB:
DB_NAME=parental_coordination_test pnpm typeorm migration:run

# Drift check — expect "No changes in database schema were found":
DB_NAME=parental_coordination_test pnpm typeorm migration:generate src/database/migrations/_verify --pretty
```

`docker compose up` now runs the same migration command through the one-shot
`migrate` service; `api` and `worker` wait for it to exit 0
(`service_completed_successfully`).

## 7. Check the app

```bash
# Watch the app pod:
minikube kubectl -- get pods -w

# Once Running+Ready, access the API:
minikube kubectl -- port-forward svc/parental-coordination-back 3000:3000

# Or use the NodePort:
# http://$(minikube ip):30001/api/auth/me

# Swagger docs:
# http://$(minikube ip):30001/docs
```

## 8. Check the worker

```bash
minikube kubectl -- rollout status deployment/parental-coordination-worker --timeout=120s
minikube kubectl -- logs deployment/parental-coordination-worker --tail=50
```

Expect `WorkerBootstrap ... worker running (consuming BullMQ jobs)` and no
crash loop. A few `ECONNREFUSED` retries during the first rollout (Redis or
schema not ready yet) are normal; a persistent loop is not.

Kill switches live in `app-config` (worker restarts to pick them up):
`NOTIFICATIONS_FANOUT_ENABLED=false` keeps webhooks and dispatched marking but
writes no notifications; `REALTIME_PUBLISH_ENABLED=false` stops publishing
`activity.changed`.

## 9. Teardown

```bash
minikube kubectl -- delete -f k8s/     # remove all resources (incl. the PVC → data gone)
minikube stop                          # stop the VM (data kept)
minikube delete                        # wipe the whole VM — data GONE
```

Caveats (dev-only setup, by design):

- **Plain dev Secret** — no encryption at rest; fine locally. Kustomize /
  SealedSecrets is a future improvement.
- **Node-local storage** — the PVC uses minikube's hostpath provisioner;
  `minikube delete` wipes all data (accepted). No multi-node persistence.
- **StatefulSet delete keeps data** — `minikube kubectl -- delete statefulset
  postgres` leaves the `postgres-data` PVC intact, so data survives a redeploy;
  `kubectl delete -f k8s/` removes everything (same for `redis-data`).
- **In-cluster DNS** — the app and the worker connect to Postgres at
  `postgres:5432` (headless Service, stable per-pod DNS `postgres-0.postgres`)
  and to Redis at `redis:6379` (ClusterIP Service).
- **Redis has no password** — dev-only, reachable only inside the cluster via
  the `redis-allow` NetworkPolicy. For a managed Redis, skip
  `redis-pvc.yaml`/`redis-service.yaml`/`redis-statefulset.yaml`, point
  `REDIS_HOST`/`REDIS_PORT` at the managed endpoint and add `REDIS_PASSWORD`
  (plus `REDIS_TLS=true` if required) to `app-secret`.
- **Worker replicas stay at 1** — BullMQ tolerates more consumers, but the
  retention scheduler is configured per process and webhook processors are
  concurrency-capped per pod; scale only with load evidence.
- **Worker does not migrate** — the API's `migrations` initContainer owns the
  schema; a first worker rollout may restart until it completes.
- **JWT_SECRET is a dev placeholder** — change this for any non-local deployment.
- **imagePullPolicy: IfNotPresent** — the app image must be built inside
  minikube's Docker daemon (`eval $(minikube docker-env)` + `docker build`) or
  pushed to a registry the cluster can pull from.
- **First-boot only** — `/docker-entrypoint-initdb.d` scripts run only when the
  data volume is empty; they do not re-run on existing volumes.

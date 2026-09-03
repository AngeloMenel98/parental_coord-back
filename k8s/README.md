# Parental Coordination Back — local Postgres + app on minikube

The app (and the e2e suites) need a live Postgres. These manifests run
`postgres:16-alpine` on a local minikube cluster with the same credentials as
the project `.env` (`parental` / `parental_secret` / `parental_coordination`),
plus a `parental_coordination_test` database for e2e.

The app backend is deployed as a Deployment with envFrom referencing the
in-cluster Postgres at `postgres:5432`.

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

```bash
minikube kubectl -- apply -f k8s/
```

This creates: `postgres-secret` (Secret), `postgres-initdb` (ConfigMap with
`10-create-test-db.sql`), `postgres` (headless Service), `postgres-data` (PVC
5Gi, storageClass `standard`), `postgres` (StatefulSet, 1 replica),
`app-config` (ConfigMap), `app-secret` (Secret), `parental-coordination-back`
(Deployment), `parental-coordination-back` (NodePort Service).

## 4. Wait until Postgres is Ready

```bash
# Blocks until postgres-0 is Ready (pg_isready passes) or times out:
minikube kubectl -- rollout status statefulset/postgres --timeout=180s

# Or watch the pod directly:
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

## 6. Apply migrations

```bash
# Apply the hand-authored initial migration to the dev DB (in-cluster or local):
pnpm typeorm migration:run

# For the test DB:
DB_NAME=parental_coordination_test pnpm typeorm migration:run

# Drift check — expect "No changes in database schema were found":
DB_NAME=parental_coordination_test pnpm typeorm migration:generate src/database/migrations/_verify --pretty
```

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

## 8. Teardown

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
  `kubectl delete -f k8s/` removes everything.
- **In-cluster DNS** — the app connects to Postgres at `postgres:5432`
  (headless Service, stable per-pod DNS `postgres-0.postgres`).
- **JWT_SECRET is a dev placeholder** — change this for any non-local deployment.
- **imagePullPolicy: Never** — the app image must be built inside minikube's
  Docker daemon (`eval $(minikube docker-env)` + `docker build`).
- **First-boot only** — `/docker-entrypoint-initdb.d` scripts run only when the
  data volume is empty; they do not re-run on existing volumes.

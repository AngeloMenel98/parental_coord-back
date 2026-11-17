# ---------------------------------------------------------------------------
# Parental Coordination Backend — multi-stage Dockerfile
# ---------------------------------------------------------------------------
# Uses pnpm for dependency management. The final runtime stage is minimal and
# runs as a non-root user. bcryptjs is pure JS (no native build), so no extra
# build toolchain is needed in the final image.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Node 26 is a functional requirement, not a preference:
# `@supabase/supabase-js` builds its Realtime client inside `createClient()` and
# throws on Node 20, which has no global `WebSocket`. StorageService catches that
# throw, so the failure is silent and every attachment presign returns
# "Storage not configured".
#
# All three stages build on this one ARG so they cannot drift apart. Keep it in
# sync with `.nvmrc`, `engines` in package.json and the README setup section —
# `engines` said 26.x while every stage here still said 22, which made the image
# build on a different runtime than the one the project pins.
#
# Node 25 unbundled Corepack, so `node:26-alpine` has no `corepack` binary:
# pnpm is installed from npm in the stages that need it, pinned to the version
# declared in `packageManager` (package.json).
# ---------------------------------------------------------------------------
ARG NODE_VERSION=26

# ---- Stage 1: install dependencies (with dev deps for build) ----
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# No Corepack in this image: install the pinned pnpm from npm instead.
RUN npm install -g pnpm@10.34.4
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Stage 2: build (typecheck + compile to dist/) ----
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.34.4
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prune to production before copying runtime deps (keeps final image lean).
RUN pnpm build && pnpm prune --prod

# ---- Stage 3: runtime (minimal) ----
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Run as non-root user.
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
# The app listens on PORT (default 3000). Migrations are run separately via
# `pnpm typeorm migration:run` (see k8s/README.md) — this image only serves.
CMD ["node", "dist/src/main.js"]

# ---------------------------------------------------------------------------
# Parental Coordination Backend — multi-stage Dockerfile
# ---------------------------------------------------------------------------
# Uses pnpm for dependency management. The final runtime stage is minimal and
# runs as a non-root user. bcryptjs is pure JS (no native build), so no extra
# build toolchain is needed in the final image.
# ---------------------------------------------------------------------------

# ---- Stage 1: install dependencies (with dev deps for build) ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- Stage 2: build (typecheck + compile to dist/) ----
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prune to production before copying runtime deps (keeps final image lean).
RUN pnpm build && pnpm prune --prod

# ---- Stage 3: runtime (minimal) ----
FROM node:20-alpine AS runtime
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
CMD ["node", "dist/main.js"]

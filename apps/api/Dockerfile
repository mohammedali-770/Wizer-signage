# =============================================================================
# MasterSignage API — multi-stage Dockerfile (pnpm monorepo)
#
# IMPORTANT: the build context is the REPOSITORY ROOT, not apps/api, so that
# this Dockerfile can access pnpm-workspace.yaml, the lockfile and the internal
# workspace packages (packages/*) that the API consumes as TS source.
#
# In docker-compose this is wired up as:
#   services:
#     api:
#       build:
#         context: .                 # repo root
#         dockerfile: apps/api/Dockerfile
# =============================================================================

# --- Base --------------------------------------------------------------------
# Pin a concrete Node 20 alpine image and enable corepack-managed pnpm@9.
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# --- Dependencies ------------------------------------------------------------
# Copy only the manifests first to maximise Docker layer caching: dependency
# layers are only rebuilt when a package.json or the lockfile changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
# Shared TS base config — extended by the API build (tsconfig.build.json) and by
# the internal packages' build configs below.
COPY tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/types/package.json ./packages/types/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/ui/package.json ./packages/ui/package.json
# Install the API and its workspace dependency graph only.
RUN pnpm install --filter @master-signage/api... --frozen-lockfile

# --- Build -------------------------------------------------------------------
FROM base AS build
ENV PATH="$PNPM_HOME:$PATH"
# Reuse the resolved node_modules from the deps stage.
COPY --from=deps /app /app
# Bring in the full source for the API and the workspace packages it imports.
COPY apps/api ./apps/api
COPY packages ./packages
# Generate the Prisma client (required before the TS build can typecheck the
# generated model types).
RUN pnpm --filter @master-signage/api db:generate
# Compile the NestJS app AND the internal workspace packages it consumes
# (@master-signage/shared, /types). The trailing `...` includes the API's
# workspace dependencies and pnpm runs them in topological order (types/shared
# before api). This emits each package's dist/ JS so the runtime image carries
# compiled JavaScript, not raw TypeScript source.
RUN pnpm --filter "@master-signage/api..." build
# Prune dev dependencies for a lean runtime node_modules.
# NOTE: `pnpm deploy` targets exactly ONE project — it already bundles the
# target's workspace dependencies (@master-signage/shared, /types) into the
# deployed node_modules. A trailing `...` would expand the filter to those
# workspace projects too and pnpm refuses (ERR_PNPM_CANNOT_DEPLOY_MANY).
RUN pnpm --filter @master-signage/api --prod deploy /app/deploy
# Re-generate the Prisma client INTO the pruned deploy tree so the runtime image
# carries it (avoids the pnpm-deploy + hoisted-.prisma gotcha). prisma is a
# production dependency, so its CLI is present under deploy/node_modules/.bin.
RUN cd /app/deploy && ./node_modules/.bin/prisma generate --schema /app/apps/api/prisma/schema.prisma

# --- Runtime -----------------------------------------------------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV API_PORT=3001
WORKDIR /app

# Prisma's schema/query engines (linux-musl-openssl-3.0.x) need OpenSSL/libssl
# at runtime to start and connect; node:20-alpine does not ship it. Install it
# as root before dropping to the unprivileged user, otherwise `prisma migrate
# deploy` / the client fail with "failed to detect the libssl/openssl version".
RUN apk add --no-cache openssl

# Run as the unprivileged "node" user shipped in the base image.
COPY --from=build --chown=node:node /app/deploy/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json
# Schema + migrations so `prisma migrate deploy` can run from this image
# (prisma CLI ships in node_modules as a production dependency).
COPY --from=build --chown=node:node /app/apps/api/prisma ./prisma

USER node
EXPOSE 3001

# Liveness check against the API health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]

# syntax=docker/dockerfile:1

# =============================================================================
# Wizer Signage Dashboard (Next.js 14, App Router)
# Multi-stage build. BUILD CONTEXT MUST BE THE REPOSITORY ROOT, e.g.:
#   docker build -f apps/dashboard/Dockerfile -t wizer-signage-dashboard .
# (docker-compose sets build.context to ./apps/dashboard's parent root.)
# =============================================================================

# ----- Base: pnpm (installed directly; corepack is gone in Node 26) ---------
FROM node:26-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Corepack is NOT shipped in node:26-alpine — Node removed it from the
# distribution after 24, so `corepack enable` exits 127. pnpm is installed
# directly instead, pinned to the exact version in the root package.json
# `packageManager` field so the image resolves the lockfile identically to
# local development. Keep this in step with that field.
RUN npm install -g pnpm@9.12.0
WORKDIR /app

# ----- Dependencies: install with the full workspace graph -------------------
FROM base AS deps
# Root manifests + lockfile + workspace config.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./
COPY tsconfig.base.json ./
# Internal packages consumed as TS source.
COPY packages ./packages
# Only the dashboard app manifest is needed to resolve its deps.
COPY apps/dashboard/package.json ./apps/dashboard/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @wizer/dashboard...

# ----- Builder: compile the standalone output --------------------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# Emit the self-contained standalone server bundle for the runtime image.
ENV NEXT_OUTPUT=standalone
# Public API base URL is baked into the client bundle at BUILD time (Next.js
# inlines NEXT_PUBLIC_*). It MUST be passed as a build arg (from compose or
# `docker build --build-arg`) and point at your public HTTPS API base, e.g.
# https://api.example.com/api. There is deliberately NO default: a production
# build with this unset FAILS in next.config.mjs (env-validation.mjs) rather
# than silently baking a localhost URL into every browser.
# This is NOT a secret (it ships to the browser); never pass secrets this way.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Bring the FULLY-resolved workspace from deps — including the per-package
# node_modules. pnpm links each app's binaries under its own
# apps/dashboard/node_modules/.bin (NOT the root node_modules), so copying only
# the root node_modules leaves `next` off PATH ("next: not found"). Copying the
# whole /app tree (as the API Dockerfile does) carries those binaries through.
COPY --from=deps /app /app
# Overlay the dashboard + workspace package source. node_modules is excluded by
# the root .dockerignore, so the resolved modules copied above are preserved.
COPY apps/dashboard ./apps/dashboard
COPY packages ./packages
RUN pnpm --filter @wizer/dashboard build

# ----- Runner: minimal runtime image -----------------------------------------
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DASHBOARD_PORT=3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone server bundles its own minimal node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/dashboard/public ./apps/dashboard/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The standalone server entrypoint is emitted next to the app's path.
CMD ["node", "apps/dashboard/server.js"]

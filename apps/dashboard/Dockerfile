# syntax=docker/dockerfile:1

# =============================================================================
# MasterSignage Dashboard (Next.js 14, App Router)
# Multi-stage build. BUILD CONTEXT MUST BE THE REPOSITORY ROOT, e.g.:
#   docker build -f apps/dashboard/Dockerfile -t mastersignage-dashboard .
# (docker-compose sets build.context to ./apps/dashboard's parent root.)
# =============================================================================

# ----- Base: pnpm via corepack ----------------------------------------------
FROM node:20-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate
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
    pnpm install --frozen-lockfile --filter @master-signage/dashboard...

# ----- Builder: compile the standalone output --------------------------------
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# Emit the self-contained standalone server bundle for the runtime image.
ENV NEXT_OUTPUT=standalone
# Public API base URL is baked into the client bundle at BUILD time (Next.js
# inlines NEXT_PUBLIC_*). Set it to your public API origin, e.g.
# https://signage.example.com/api  — passed as a build arg from compose.
# This is NOT a secret (it ships to the browser); never pass secrets this way.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/dashboard ./apps/dashboard
RUN pnpm --filter @master-signage/dashboard build

# ----- Runner: minimal runtime image -----------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DASHBOARD_PORT=3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

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

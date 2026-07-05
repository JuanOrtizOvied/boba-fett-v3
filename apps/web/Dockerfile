# syntax=docker/dockerfile:1
#
# Multi-stage production image for the Next.js frontend.
#
# This repo is a Yarn workspace monorepo, so the build context MUST be the
# repository root (not apps/web) — workspace dependencies won't resolve
# otherwise. Build from the repo root:
#
#   docker build -f apps/web/Dockerfile -t web .
#
FROM node:20-alpine AS base

# --- Dependencies ---
FROM base AS deps
WORKDIR /repo
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN yarn install --immutable

# --- Builder ---
FROM base AS builder
WORKDIR /repo
RUN corepack enable
COPY --from=deps /repo/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn workspace web build

# --- Runner ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install -g pm2

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# next.config.ts pins `outputFileTracingRoot` to the repo root, so the
# standalone output mirrors the monorepo path and lands under apps/web/*.
COPY --from=builder /repo/apps/web/.next/standalone/apps/web ./
COPY --from=builder /repo/apps/web/.next/standalone/node_modules ./node_modules
COPY --from=builder /repo/apps/web/.next/static ./.next/static
COPY --from=builder /repo/apps/web/public ./public
COPY --from=builder /repo/apps/web/ecosystem.config.js .

USER nextjs

EXPOSE 3000

CMD ["pm2-runtime", "ecosystem.config.js"]

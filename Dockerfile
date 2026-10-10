# One image for the API, the realtime gateway, the worker and migrations;
# docker-compose picks what each container runs. A second target builds the
# web app and serves it, with HTTPS for everything, through Caddy.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
# Manifests first, so dependencies are only reinstalled when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/mobile/package.json apps/mobile/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/

FROM base AS server
# Everything but the phone app, which the servers never need.
RUN pnpm install --frozen-lockfile --filter tagalong --filter "@tagalong/api..." --filter "@tagalong/worker..."
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
ENV NODE_ENV=production
USER node
CMD ["pnpm", "--filter", "@tagalong/api", "start"]

FROM base AS web-build
RUN pnpm install --frozen-lockfile --filter tagalong --filter "@tagalong/mobile..."
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/mobile ./apps/mobile
# Baked in at build time: where the web app finds the API.
ARG EXPO_PUBLIC_API_URL
ARG EXPO_PUBLIC_GATEWAY_URL
ARG EXPO_PUBLIC_APP_URL
RUN pnpm --filter @tagalong/mobile exec expo export --platform web --output-dir dist

FROM caddy:2-alpine AS proxy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/mobile/dist /srv/web

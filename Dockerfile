# syntax=docker/dockerfile:1
# One build for the whole monorepo, three images:
#   docker build --target api .       the NestJS API
#   docker build --target web .       the storefront and dashboard (React Router SSR)
#   docker build --target migrate .   applies Prisma migrations, then exits (run before each release)
# Each runtime image holds only its app's compiled code and production dependencies.
# The Node image is written out in both FROM lines (not as an ARG) so Dependabot can update it.

FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install --global pnpm@12.15.0 && npm cache clean --force
WORKDIR /repo

# Dependencies first: this layer is reused until the lockfile changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile

FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile \
 && pnpm build \
 && pnpm --filter @forgea/api deploy --prod /out/api \
 && pnpm --filter @forgea/web deploy --prod /out/web

# What migrations need, and nothing else: the schema, the migrations, its config, and the
# Prisma CLI and dotenv at exactly the versions the lockfile installed (the CLI is a dev
# dependency, so it isn't in /out/api). About 200 MB instead of the whole build tree.
RUN mkdir -p /out/migrate/prisma \
 && cp -r api/prisma/schema api/prisma/migrations /out/migrate/prisma/ \
 && cp api/prisma7.config.ts /out/migrate/ \
 && cd /out/migrate \
 && printf '{"name":"forgea-migrate","private":true,"type":"module"}\n' > package.json \
 && npm install --omit=dev --no-audit --no-fund --no-save \
      "prisma@$(node -p "require('/repo/api/node_modules/prisma/package.json').version")" \
      "dotenv@$(node -p "require('/repo/api/node_modules/dotenv/package.json').version")" \
 && npm cache clean --force

FROM node:24.22.2-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS runtime
ENV NODE_ENV=production PORT=3000
# The apps run with node alone: drop the npm/corepack the Node image bundles (unused code that
# security scanners flag, e.g. npm's own copies of undici and brace-expansion).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
EXPOSE 3000

# Applies pending migrations, then exits: started by the deploy, never serves traffic.
FROM runtime AS migrate
COPY --from=build --chown=node:node /out/migrate ./
USER node
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
# Uploads and unsent emails live on volumes mounted here, owned by the unprivileged user.
RUN mkdir -p /data/uploads /data/outbox /data/outbox-whatsapp && chown -R node:node /data
ENV UPLOAD_DIR=/data/uploads MAIL_OUTBOX_DIR=/data/outbox
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main.js"]

FROM runtime AS web
COPY --from=build --chown=node:node /out/web ./
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/shop').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node_modules/.bin/react-router-serve", "build/server/index.js"]

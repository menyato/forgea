# Local setup

Requirements: Node 24+, pnpm 12.15 (`npm i -g --allow-scripts=pnpm pnpm@12.15.0`), PostgreSQL 16+.

## 1. Install and build

```sh
pnpm install
pnpm build
```

## 2. Database

The API connects with a dedicated, least-privilege role — never the `postgres` superuser.
Run once in `psql` as a superuser (pick your own password):

```sql
CREATE ROLE forgea_app LOGIN PASSWORD 'choose-a-strong-password';
-- CREATEDB lets `prisma migrate dev` create its temporary shadow database.
ALTER ROLE forgea_app CREATEDB;
CREATE DATABASE forgea OWNER forgea_app;
REVOKE ALL ON DATABASE forgea FROM PUBLIC;
```

The app never connects as a superuser. If the same Postgres server hosts other databases (e.g. Odoo),
`forgea_app` has no access to them.

Then:

```sh
cp api/.env.example api/.env       # set the password in DATABASE_URL
pnpm --filter @forgea/api exec prisma migrate deploy
```

### No local Postgres? Use Docker

```sh
docker compose -f compose.dev.yaml up -d   # Postgres on localhost:5432; settings in the file
```

### Or Prisma's throwaway database

`prisma dev` runs a local Postgres-compatible database (PGlite) with no Docker:

```sh
cd api
pnpm exec prisma dev --name forgea-dev --detach
# connection: postgresql://postgres:postgres@localhost:51214/template1?sslmode=disable
```

## 3. Run

```sh
pnpm --filter @forgea/api start:dev    # http://localhost:3000/health
pnpm --filter @forgea/web dev          # http://localhost:5173
```

## See the dashboard

```sh
pnpm build
pnpm --filter @forgea/api db:seed   # example catalog (designer collection included), via the importer
pnpm dashboard                        # Chrome opens on /admin, signed in as BOOTSTRAP_ADMIN_EMAIL
```

The API and the storefront must be running (section 3). `WEB_URL=http://localhost:5199 pnpm dashboard`
opens another storefront address. Staff sign in with Google once its credentials are in `api/.env`.

Emails: without `GOOGLE_SERVICE_ACCOUNT_KEY`, every email is written to `api/.outbox/` as an
`.eml` file (open it with Outlook or any mail app) instead of being sent. The e2e tests use
`api/.outbox-test/`.

## 4. Tests

```sh
pnpm test                                # unit tests, every package
pnpm --filter @forgea/api test:e2e       # API against TEST_DATABASE_URL (migrated automatically)
pnpm build && pnpm --filter @forgea/web test:browser
                                         # real Chrome, desktop + phone; own ports 3098/5198,
                                         # test database migrated and seeded first
pnpm knip                                # unused files, exports or dependencies (must be empty)
```

The browser tests use the Chrome installed on your machine; nothing is downloaded.

## Changing the schema

1. Edit the feature's file in `api/prisma/schema/`.
2. `pnpm --filter @forgea/api exec prisma migrate dev --name <change>` — writes a new migration and applies it.
3. `pnpm generate` — refreshes the API client and the shared enums in `@forgea/types`.
4. Commit the migration folder. Never edit a migration that has already been applied anywhere.

## Moving to another computer

The code is portable: no path or setting in it names this machine. Four things live outside
git, and the database is not in the folder at all.

| What | Where | Bring it? |
|---|---|---|
| Code | the repository | `git clone` (or copy the folder) |
| Settings and secrets | `api/.env`, `web/.env` | copy by hand (or start again from the `.env.example` files); keep them private |
| Uploaded files (models, fonts, images) | `api/.uploads/` | copy it: the database only keeps their keys |
| Products, orders, accounts, books | PostgreSQL (`forgea`; tests use `forgea_test`) | dump and restore, below |
| Installed packages and builds | `node_modules/`, `dist/`, `build/` | **don't copy**: made for this machine; rebuilt below |

On the old computer:

```sh
pg_dump -Fc -d forgea -f forgea.dump      # add -U/-h as in your DATABASE_URL
```

On the new one (Node 24+, pnpm 12.15, PostgreSQL 16+ installed):

```sh
git clone https://github.com/menyato/forgea.git && cd forgea   # or the copied folder, without node_modules
# put back api/.env, web/.env and api/.uploads/
# create the forgea_app role and the forgea database as in section 2, then:
pg_restore -d forgea --no-owner --role=forgea_app forgea.dump
pnpm install
pnpm build
pnpm --filter @forgea/api exec prisma migrate deploy   # anything newer than the dump
```

The test database needs no copying: create an empty `forgea_test` (section 2) and the tests
migrate and seed it themselves. Only work that is committed and pushed comes with `git clone`.

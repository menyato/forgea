# Forgea

E-commerce platform for a 3D-printing and electronics design studio. pnpm monorepo, TypeScript everywhere.

## Layout

- `api/` — NestJS 12 (ESM) + Prisma 7 + PostgreSQL. One folder per feature in `src/<feature>/` (module, controller, service, DTOs together). Infrastructure lives in `src/config/`, `src/database/`, `src/health/`.
- `api/prisma/schema/` — one `.prisma` file per feature, named like its `src/<feature>/` folder.
- `web/` — React Router 8, framework mode (SSR), file-based routes via `@react-router/fs-routes`. Each route is a folder `app/routes/<route>/` with `route.tsx` plus its own components/hooks/API calls. Code shared by several routes goes in `app/features/<name>/`; brand-level UI in `app/components/`.
- `packages/` — shared code consumed by both apps, compiled to `dist/` with `tsc`:
  - `brand` — design tokens (`src/tokens.ts` is the one file to edit for palette/fonts) and logo SVGs.
  - `types` — enums generated from the Prisma schema (second generator), plus shared domain types.
  - `pricing` — pure pricing engine (Phase 2).
  - `validation` — class-validator DTO classes shared by api and web (Phase 4).
- `docs/` — ROADMAP, LOCAL_SETUP, SECURITY, BACK_OFFICE, CATALOG_IMPORT.
- `Dockerfile` (targets `api`, `web`, `migrate`), `deploy/` (the servers' Compose stack, Caddy, deploy and backup scripts, env templates), `infra/` (server setup), `.github/workflows/` (CI; branches `development` → `staging` → `production`, the last two deploy to their environment).

## Rules

- `strict` TypeScript in every tsconfig (via `tsconfig.base.json`); no `any`, no turning strict flags off.
- Shared logic lives only in `packages/*`. Before duplicating anything between api and web, say so explicitly.
- api: one class per responsibility, everything injected, no business logic in controllers.
- web: function components and hooks; classes only for non-UI code (ApiClient, form schemas).
- Scaffold with each framework's CLI (`nest g resource <name> --type rest --crud false`, `prisma migrate dev`), verifying the current command first.
  `nest g resource` also adds `"@nestjs/mapped-types": "*"` to api/package.json — remove it (unpinned and unused).
- New migrations: `prisma migrate dev --name <x> --create-only`, check the folder sorts after the existing ones (names are timestamps), add hand-written CHECK constraints, then apply.
- Order status never changes without a new `OrderStatusHistory` row in the same transaction.
- Files are stored as object keys (`clean/<id>.<ext>`), never URLs; the bytes sit on a private volume and are served only through the API's rules.
- Money: USD is the base currency; other currencies only via `CurrenciesService` (admin-set, dated rates). Documents store their currency, rate and converted amounts. Never hardcode a rate.
- Database sessions run in UTC (`PrismaService`); don't remove that option — see `test/timestamps.e2e-spec.ts`.
- Versions shared across packages go in the `catalog:` in `pnpm-workspace.yaml`. Prisma is pinned to exact `7.10.1` (the npm `latest` tag of `prisma` is an 8.0 RC).
- Dependency install scripts are blocked unless listed under `allowBuilds` in `pnpm-workspace.yaml`.
- Work phase by phase (see `docs/ROADMAP.md`); after each phase report what was built, why, what was uncertain, what was simplified, then wait for approval.

## Storefront conventions

- Browsers never call the API. Loaders/actions use `context.get(apiContext)` (one `ApiClient` per request, created in root middleware), which forwards cookies, renews sessions once and relays Set-Cookie.
- Validate forms in actions with the shared DTOs via `validateForm` (`~/lib/forms.server`). Browser code imports plain values from `@forgea/validation/constants`, never the DTO entry (keeps class-validator out of client bundles).
- Shared names (cookies, headers) come from `HTTP` in `@forgea/types`; types shared with the API (`Profile`, `CartView`, `Page<T>`…) too.
- In loaders/actions, read the page URL from the `url` argument, never `new URL(request.url)`: on client navigations `request.url` is the internal `/page.data` URL.
- Anyone can browse and fill a cart; ordering needs an account + phone. Pages that need an account redirect with `signInFor(url)`; sign-in returns via `?next=` (`safeNext`).
- Store settings (transfer and WhatsApp numbers) come from the root loader (`store`); WhatsApp links only through `WhatsAppLink` / `whatsappUrl`.
- Light/dark: `forgea_theme` cookie read on the server, `<html data-theme>`; colours only through the brand tokens' CSS variables, never hardcoded.

## Dashboard and catalog conventions

- Dashboard routes are `app/routes/admin*`; the `admin` layout's `staffMiddleware` refuses visitors and customers, and its `SECTIONS` list says which roles see each page. The API still checks every call and `@Audit`s changes.
- Roles: ADMIN everything (plus the books and reports); STAFF orders, production, request quotes, leads, quotations, invoices and payments; DESIGNER catalog, 3D uploads, request designs and the home page bed. Team members are Workspace accounts (Google only); `disabledAt` switches one off.
- Status changes (orders and custom requests) go through guarded `updateMany` calls inside a transaction that first calls `setStatusActor` (`api/src/common/status-actor.ts`); database triggers write the history.
- The home page bed shows products by `plateOrder` (1 = centre … 5), set in Dashboard → Home page bed (`PUT /products/plate`); with none set, the newest products with a model stand in. Model files are preloaded in the home route's `meta`, and printing starts only once every model has loaded.
- The catalog moves between installations as one JSON file (docs/CATALOG_IMPORT.md); the importer reuses the catalog services and DTOs. The seed (`api/scripts/seed.ts`) loads `prisma/example-catalog.ts` through it.
- Every catalog rule is data the owner edits (categories, materials, option groups and values with their price rules); never hard-code a colour, size, price or limit.
- Product pricing always goes through `ProductConfigurator` (api) → `configuredUnitPrice` (`@forgea/pricing`). The browser shows prices from the API only.
- Dashboard actions use `save(Dto, values, send)` from `~/features/admin/staff.server` (shared DTO check, then the API call).
- Files: upload to the API, store the returned object key, show it via `/media/<key>`. 3D models render only through `ModelViewer` (three.js loads lazily, client-only). STL is Z-up; the viewer stands it upright.
- Browsers load models as the API's compressed copies (`modelVariantKey(key, 'view' | 'lite')` from `@forgea/validation/constants`, made by `ModelVariants`): `lite` for cards and the home bed, `view` on product pages; the original file only where the dashboard measures it. Never send an original STL to a page that just shows it.
- `pnpm dashboard` opens the dashboard signed in as the local admin (dev only; see docs/SECURITY.md).

## Back office conventions

- Design: docs/BACK_OFFICE.md (Odoo 20 `crm`/`sale`/`account` as the functional reference, nothing copied).
- Every sale is an order: quotations become orders through `CheckoutService.placeQuotation`, like checkout and custom requests.
- Quotation status changes follow the order rule (guarded update + `setStatusActor`; a trigger writes the history).
- Ledger entries only through `Ledger.post` (draft with lines, then posted with a number). Never update or delete a posted entry; the database refuses it. Corrections are new entries or credit notes.
- Order invoices come from `Invoicing.onOrderStatus`; its failures are logged, never block the status change.
- Prices include tax (`splitTaxIncluded`); the sales tax is an owner setting, never hard-coded.
- Emails go through `NotificationsService.send(template, data)`; they never block or fail the action. Without the service account key they land in `MAIL_OUTBOX_DIR`.

## Commands

```sh
pnpm install
pnpm generate          # Prisma client + shared enums (run after any schema change)
pnpm build             # generate, then build packages → api → web
pnpm test              # unit tests (Vitest) in every package
pnpm typecheck
pnpm --filter @forgea/api test:e2e   # uses TEST_DATABASE_URL (separate DB, migrated automatically)
pnpm --filter @forgea/web test:browser  # Playwright, system Chrome; run `pnpm build` first
pnpm knip              # must report nothing: no unused files, exports or dependencies
pnpm dashboard         # local dev: opens Chrome signed in as the local admin (pnpm build first)
pnpm --filter @forgea/api db:seed    # example catalog for local development, via the importer (refuses production; pnpm build first)
pnpm --filter @forgea/api catalog:import file.json [--update]   # import a catalog file (works on production; pnpm build first)
pnpm format
```

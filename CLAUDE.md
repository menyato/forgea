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
- `marketing/` — not in git: brand kit (`brand-kit/BRAND-GUIDE.md`, primary logo `logo/primary/forgea-logo_dark.svg`), Instagram reels/posts, motion pieces. Social/video colours match the `copper` palette in `packages/brand`.
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
- Times: the API keeps UTC; pages show and take them in the studio's time, Beirut (`~/lib/studio-time`: `studioFormat`, `studioInput`/`fromStudioInput` for datetime-local fields, `studioDay`). Documents are dated by the studio's day, and report periods (orders, stock, production) count timestamps by the same days (`studioDayStart`: Beirut midnight), so an order placed just after midnight and its invoice fall on the same day.
- Light/dark: `forgea_theme` cookie read on the server, `<html data-theme>`; colours only through the brand tokens' CSS variables, never hardcoded.
- The shell's public reads (`/store-settings`, `/site-theme`) go through `api.shared()`: kept 10 s per web process, forgotten at once by any change sent through it. A visitor with neither a session nor a cart cookie costs no cart call.
- Layout: grid tracks are `minmax(0,…fr)` and `Panel`s are `grid-cols-1`, so a canvas or a long email can't widen a page; `web/browser/layout-audit.spec.ts` checks every page on desktop and phone. Unknown addresses hit `routes/$` (a quiet 404).
- `web/browser/personas.spec.ts` (five customers + the studio receiving them) and `studio.spec.ts` (every dashboard action, stage by stage) are the end-to-end journeys: each fails on any console error, crash, 5xx or slow page.

## Dashboard and catalog conventions

- Dashboard routes are `app/routes/admin*`. Every page has a rule in `PAGES` (`app/features/admin/access.ts`): `staffMiddleware` refuses a page someone's permissions don't cover (even typed in) and the menu lists only the rest; an unlisted page is admin-only. Buttons and forms show only with `useCan()('x.y')`; read-only pages use `<ViewOnly>`. Menu entries carry a `group` (Sales, Orders, Accounting, Catalog, Settings: `DashboardNav`), and `config: true` lists one under its group's Configuration heading; every record type has a list (`/admin/<x>`), a form (`/<id>`) and a `/new` page; lists are paged by the API (keyset `cursor`, filters and search in the query, sums like an invoice's open amount in SQL: `InvoiceListRepository`), never by fetching a capped list and filtering it in the page; record lists are Odoo-style (`~/features/admin/views`): `ControlPanel` (search, filters as removable facets, group by, pager, List | Kanban), `ListView` (sortable headers via the API's `sort`/`order`, the row opens the record), `KanbanView` (`move` posts `intent=move` to the page's action, which makes the record's own API call); all state in the address, read by `listState` in loader and page; the form is its own page, `AdminHeader` adds "‹ 3 / 25 ›" through the list it came from; counts from `GET /<list>/counts`. Old `?tab=` addresses still open the same filter.
- Every form control has an id or name and says whether autofill applies (`autocomplete`; the shared fields default it). `web/browser/page-audit.spec.ts` fails on any DevTools issue, console error or such field, on every page. The API still checks every call and `@Audit`s changes.
- Permissions (`PERMISSION_GROUPS` in `@forgea/types`) are the unit of access, not roles. Every team API route says `@RequirePermission('x.y')` or `@AdminOnly()`; `PermissionsGuard` reads the caller's role, permissions and `disabledAt` from the database on each call, so changes apply at once. Effective = role's permissions (Roles & permissions page) + the person's grants − denials, with `PERMISSION_INCLUDES` added; a denial always wins. ADMIN holds everything, CUSTOMER nothing; managing the team and permissions is admin-only and never a permission. Data someone may not see is left out by the API (`@CallerPermissions()`), not just hidden. A new signed-in route without a permission must be added to `CUSTOMER_ROUTES` in `api/test/permissions.e2e-spec.ts`, which checks every route.
- Roles (defaults, editable): STAFF orders, production, request quotes, leads, quotations, invoices and payments; DESIGNER catalog, 3D uploads, request designs and the home page bed. Team members are Workspace accounts (Google only); `disabledAt` switches one off.
- Status changes (orders and custom requests) go through guarded `updateMany` calls inside a transaction that first calls `setStatusActor` (`api/src/common/status-actor.ts`); database triggers write the history.
- Business page (`/admin/insights`, `GET /insights`, `books.view`): revenue, expenses and net profit come only from `Books.profitAndLoss`; production cost is an estimate (invoiced order lines × `ProductionEstimator` → `configuredUnitCost`, today's settings) and is always labelled "estimated"; sums in SQL (`InsightsRepository`), money as Decimal. Periods via `PeriodQuery` (UTC days, ≤ 2 years). See docs/BACK_OFFICE.md.
- Filament stock (`/admin/stock`, per material + colour): only through `StockRepository.record` (append-only `stock_movements`; a trigger keeps `materials.stockGrams`, never typed in). Orders take their grams when they go IN_PRODUCTION, inside the status change's transaction (`OrderStock`); failed print jobs take theirs. Restock limits are the owner's per line (`stock.manage`). A stock line keeps how its colour looks (`hex`, picked as RGB when spools come in, are weighed, or on the line's page), shown before the shop's swatch of that name. The team records four actions, never raw grams: spools received (price → the material's cost per gram; paid → booked through `Purchases`), printed for the studio and failed prints (grams and cost from the product via `ProductionEstimator`), and weighing (the difference). Movements keep their `cost`/`costPerGram`; see docs/BACK_OFFICE.md.
- The dashboard's product list and kanban show each product's 3D model as the shop's cards do (`ProductPreview` → `ModelThumbnail`, the `lite` copy).
- An order's page opens with its figures (`SmartButtons`, as Odoo's smart buttons: filament, print time, cost to make, profit, invoices, each linked to where it comes from) and "What it takes to make" (`GET /orders/:id/production`, `OrderProductionService`: per line the filament by colour, time and cost from `ProductionEstimator`, and what stock really gave it); cost and profit only with `books.view`. Reuse `SmartButtons` for other records' figures.
- Spools received may be of "A new material…": the form makes the material first (its code from its name, its cost from the spool, a usual density suggested), then shelves the spools.
- Form posts that only ask something (`preview`, `model-info`, `print-files`, uploads) don't re-run loaders (`unlessAsking` in `~/lib/revalidate`), unless the page is moving to another address.
- Filaments are kept as bought: a stock line (material + the reel's name, its look and `pricePerGram` from its own spools) is one filament. A product colour may be printed from one (`ProductColour.stockItemId`, "Printed from" in the colours editor: the row takes the reel's name), and a shop colour too (`OptionValue.stockItemId`, Options page): cost uses each colour's grams at its reel's price (`averagePricePerGram`), and orders take the grams from that reel, of whatever material it is (PETG supports on a PLA piece). Without a reel, by the colour's name in the product's material, as before.
- Quotation lines pick from `GET /products/quotable` (every product, hidden ones marked "not in the shop"), so a piece made for one client is quoted and ordered without being launched.
- Dashboard pages show breadcrumbs (`AdminHeader`'s `trail`: a detail page names its list); a crumb returns to that list as it was left (tab, filters), remembered in the browser only.
- The home page bed shows products by `plateOrder` (1 = centre … 5), set in Dashboard → Home page bed (`PUT /products/plate`); with none set, the newest products with a model stand in. Model files are preloaded in the home route's `meta`, and printing starts only once every model has loaded.
- The catalog moves between installations as one JSON file (docs/CATALOG_IMPORT.md); the importer reuses the catalog services and DTOs. The seed (`api/scripts/seed.ts`) loads `prisma/example-catalog.ts` through it.
- Every catalog rule is data the owner edits (categories, materials, option groups and values with their price rules); never hard-code a colour, size, price or limit.
- Sizes are real and per product (`ProductSize`: label, X × Y × Z cm, its own grams and hours), never a shared "Small/Large" multiplier. The shop gets them as an option with `kind: 'SIZE'` under `PRODUCT_SIZE_GROUP_ID`; customers choose by measurements only ("18 × 12 × 9 cm"; the label is the owner's, never shown in the shop), choosing one prices with its grams and hours, and orders keep the measurements. New sizes are suggested by `scaledSize` (proportions from the model, grams and hours from the volume).
- Product pricing always goes through `ProductConfigurator` (api) → `configuredUnitPrice` (`@forgea/pricing`), then `withPriceOverride`: a product's own price (`priceOverride`, `pricing.manage` only) plus what the customer's choices change in the calculated price (docs/PRICING.md). The browser shows prices from the API only.
- 3MF models (Bambu Studio and other slicers): read only in the 3D worker (`three-mf.ts`); the shop gets coloured GLB copies, never the file. `POST /products/model-info` gives size, grams per colour and time (a sliced file's own, else a guess from the volume); only a sliced file's numbers price anything (the dashboard asks for the `.gcode.3mf`, quotation lines refuse an unsliced 3MF): they already hold the purge, prime tower and supports, so `Product.slicedFile` (set by the API when the product's grams and time match its file) and a sliced `PrintFile` price with `wasteIncluded` (no purge waste on top); a multi-colour product keeps them as `ProductColour` rows (they add up to its grams) and orders take each colour from its stock. Order lines of such products download the file (`/admin/orders/:id/project/:itemId`). A colour row with a `part` name ("Customers choose this colour"; a one-colour file keeps its one row so it can be recoloured too) is the customer's to recolour: the product's `partColourGroup` supplies the choices (each priced by its own `extraPrice`), the row's colour is where it starts; the shop gets it as a CHOICE option with `recolours` (the file hex, which names the GLB copy's material, so `ModelViewer`'s `recolour` swaps it live), keyed by `partGroupId(product, hex)` so saves keep carts' choices; orders record "Body: Copper silk" and stock takes the part's grams from that colour.
- A product may be shown assembled and printed from other files: its model (`modelFileKey`, any format) is the look, and its `ProductPrintFile` rows are the sliced `.gcode.3mf` files it is printed from (uploaded as product models, never public; `POST /products/print-files` reads and adds them up: grams per colour, time, and each file's `PrintSetup` — plates, supports, prime tower, printer, nozzle, layer height, infill, profile, objects — kept as the API's own snapshot in `details`). "Use the totals" makes them the product's grams, time and colours; `slicedFile` then means the numbers match the print files' total. Orders list them for download (`/admin/orders/:id/print-file/:itemId/:fileId`). The catalog file does not carry print files yet.
- A 3MF (or STL/GLB) also prices a quotation line (`POST /uploads/quotation-file`, `POST /quotations/print-file`, `quotations.manage`) and a customer's custom request (a sliced file gets an exact price and, with the owner's `autoQuoteSlicedFiles`, a quote at once). The line, the request and their order item keep a `PrintFile` snapshot (`printFile` JSON, read by the API from the file, never from the browser); stock takes its grams per colour and staff download the file from the order.
- Costs are set up once: a material's price per gram comes from its reel (`reelPrice` ÷ `reelGrams`, `pricePerGramFromReel`); the printer's hourly cost from its price, life, watts and electricity (`printerHourlyRate`, all four or none). Profit is a rule, a percentage of cost or a fixed amount (`ProfitRule`): the shop's default (Pricing page) or a product's own (`profitKind`/`profitValue`), which only `pricing.manage` may set; `POST /products/price-preview` shows the cost breakdown only to them, printer time split into wear and electricity (`splitPrinterCost`) when the printer's four details are filled in.
- Personalised products (text studio): `Product.textStyle` (KEYCHAIN, NAME, MONOGRAM, LETTERS, INITIAL_NAME: a big initial with the name across it and the product's `textDecor` around it, COUPLE: two names typed "A & B" with a heart) with its settings and a colour group; decorations are shapes in `motifs.ts`, placed on the initial's own outline so the backing always holds them; fonts are uploads (Dashboard → Fonts, `catalog.manage`). `@forgea/text3d` (HarfBuzz shaping for Arabic and Latin, Clipper backings, three.js solids) makes the piece in the browser for the live preview (`text-preview.client.tsx`) and in the API's `TextShaper` worker (never the main thread) for the price, the order and the print files, so both are the same piece. A design is measured when it goes in the cart and again at checkout; the order line keeps the whole design (`OrderItem.design`), and staff download one STL per colour (`/admin/orders/:id/print/:itemId/:colour`) or all of them as one 3MF (`/admin/orders/:id/project/:itemId`, `printProject`: one object, a part per colour in the shared frame, vertices merged). Grams by colour feed the filament stock.
- Dashboard actions use `save(Dto, values, send)` from `~/features/admin/staff.server` (shared DTO check, then the API call).
- Files: upload to the API, store the returned object key, show it via `/media/<key>`. 3D models render only through `ModelViewer` (three.js loads lazily, client-only). STL is Z-up; the viewer stands it upright.
- Browsers load models as the API's compressed copies (`modelVariantKey(key, 'view' | 'lite')` from `@forgea/validation/constants`, made by `ModelVariants`): `lite` for cards and the home bed, `view` on product pages; the original file only where the dashboard measures it. Never send an original STL to a page that just shows it.
- `pnpm dashboard` opens the dashboard signed in as the local admin (dev only; see docs/SECURITY.md).

## Security conventions (review of 2026-10-28; details in docs/SECURITY.md)

- Uploaded 3D files are never parsed on the API's main thread: compressed copies come from `ModelOptimizer` (a worker with a time limit); new GLB checks go in `glb-check.ts` (it runs before anything reads the file).
- Public upload routes put `UploadSlots` before their `FileInterceptor`.
- Anything that posts money for an order or invoice holds a lock on it (`pg_advisory_xact_lock`) and re-checks inside the transaction; the database refuses over-matching.
- Redirect targets only through `safeNext`; email links that change state need a button (POST), never a GET.
- The server's stack (`deploy/`) changes only through `deploy/sync-config.sh`; GitHub's keys can only run `forgea-deploy-gate`.

## Back office conventions

- Design: docs/BACK_OFFICE.md (Odoo 20 `crm`/`sale`/`account` as the functional reference, nothing copied).
- Every sale is an order: quotations become orders through `CheckoutService.placeQuotation`, like checkout and custom requests.
- Quotations go to any email address (`customerEmail`; `customerId` only once they have an account). Sending emails the whole quotation with a `QuotationLinkTokens` link (`/q/<token>`, no account needed to read); accepting needs an account with that address; staff confirming for someone without one creates a passwordless customer account. Line sizes are X × Y × Z in cm (all three or none). The email's subject, introduction and closing are owner text (`QUOTATION_EMAIL_DEFAULTS` when empty).
- Quotation status changes follow the order rule (guarded update + `setStatusActor`; a trigger writes the history).
- Ledger entries only through `Ledger.post` (draft with lines, then posted with a number). Never update or delete a posted entry; the database refuses it. Corrections are new entries or credit notes.
- Order invoices come from `Invoicing.onOrderStatus`; its failures are logged, never block the status change.
- Credit notes are issued from the order's Invoices panel (`books.manage`, one per invoice, `creditedBy` on the invoice). A credit note's open amount is money owed back: the refund is a payment recorded against the credit note (`POST /accounting/payments`, money out of cash or bank, matched to it).
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

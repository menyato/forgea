# Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Monorepo, shared packages, Prisma schema + first migration | Done |
| 2 | Pricing engine in `packages/pricing` (pure, fully tested); constants as admin-editable DB settings | Done |
| 3 | Security: Helmet, CORS allowlist, DTO validation, throttling, RBAC guards, uploads quarantine, CSRF, audit log, `docs/SECURITY.md` | Done — Google sign-in needs OAuth credentials to try live |
| 4 | Cursor pagination on every list endpoint via a shared DTO in `packages/validation` | Done |
| 5 | Cart (visitors and customers, merged on sign-in) and checkout (cash on delivery or money transfer to the studio's number, 50% deposit on custom items) | Done — ordering needs an account + phone (2026-10-27) |
| 6 | Order tracking: My Orders, WhatsApp chat per order, status history on every change | Done — history enforced by a database trigger |
| 7 | **3D experience** — the main selling point (see below) | Done — 7a (with the 3D logo printing on the bed), 7b, 7d (printing-logo motion) and the shop's 3D cards 2026-10-27; 7c (compressed copies of every model) 2026-10-28 |
| 8 | Admin dashboard, **including live theme control** (see below) | Done 2026-10-27 — 8a catalog; 8b orders pipeline, custom requests (quotes, designs, instant estimates), theme control, pricing, exchange rates, team with a designer role, audit log, catalog import/export, production planner (2026-10-28) |
| 9 | Google Workspace: Gmail and Calendar | Done 2026-10-28 — Gmail API + Calendar API with a service account (docs/BACK_OFFICE.md); order, request and quotation emails, email verification, print jobs on the studio calendar. Needs the key to send for real; until then emails are `.eml` files |
| 10 | Design system: final logo, palette and fonts | Done — logo (option 0, build plate) and palette (copper) chosen 2026-10-26; fonts League Spartan + Inter kept 2026-10-28. The owner can change colours in Dashboard → Theme |
| 11 | **Back office: CRM, sales and accounting** (replaces the Odoo bridge — see below) | Done 2026-10-28 — leads pipeline, quotations (customer accepts online), double-entry books with automatic invoices and payments, reports. VAT is set up but off until the owner decides |
| 12 | Tests and CI | Running since Phase 1: unit, API e2e (real Postgres), browser (Playwright, real Chrome), knip, audit; every deploy runs them first |
| 13 | Deployment | Written 2026-10-28 (Docker, Hostinger VPS, Cloudflare, GitHub Actions); runs once the servers and the repository exist |

## Phase 7 — 3D experience (main selling point)

Not just a product viewer: the site itself is interactive 3D.

Done 2026-10-27: the home page is a 3D print bed with up to five products chosen in the dashboard
(Home page bed; the Forgea logo plaque, a real STL product, in the centre) standing on it at real
size, printing layer by layer when the page opens (static with reduced motion); drag to turn it,
click a model to open it. Every shop card shows the product's real model (one shared WebGL
context draws all cards; they turn on hover). The product viewer has studio lighting, a print
plate, and lets phones scroll past it. Layout fills laptop screens; the phone header folds into
a menu; brand fonts (League Spartan, Inter) are self-hosted.

- 7a. Home page hero: an interactive 3D scene (built with react-three-fiber) that shows off the studio's best work.
- 7b. Product pages: viewer with orbit controls, color/material swap, mobile performance (Draco/meshopt, LOD).
- 7c. Model pipeline (done 2026-10-28): every uploaded STL or GLB gets two compressed GLB copies
  next to it (glTF-Transform + meshoptimizer, meshopt and 16-bit positions): `view` with every
  detail for the product page, `lite` simplified to about 30 000 triangles for shop cards and the
  home bed. A 250 000-triangle, 12.5 MB STL becomes 0.76 MB and 0.11 MB, before gzip. The upload
  stays the original, for printing and exact measuring. Older models get their copies on first
  request. Not done: texture compression for GLB uploads with photos baked in (needs sharp, a
  native module; none of the catalog uses textures).
- 7d. Interaction polish across the site: 3D accents that respond to the visitor, with `prefers-reduced-motion`
  and low-power fallbacks so it never blocks buying.

Skills used: `threejs-react-three-fiber`, `threejs-asset-pipeline`, `threejs-performance`, `threejs-loaders`,
`threejs-materials`, `threejs-lighting`, `frontend-design`, `web-design-guidelines`.

## Phase 8 — Admin dashboard

**8a (done 2026-10-27):** catalog — products with STL/GLB upload, 3D preview and grams/hours
suggested from the model; categories; option groups and values with price rules (grams and time
multipliers, fixed add-ons, material switch, text options); materials with density, print speed
and stock; payment and WhatsApp numbers. Shop: category filter, product pages with 3D view,
options and live price; cart lines per configuration.

**8b (done 2026-10-27):**

- **Orders pipeline:** list by status, order page with every next step ("Deposit received,
  confirm"), notes for the customer, who did what; WhatsApp and call links to the customer.
- **Custom requests** (docs/CUSTOM_REQUESTS.md): the storefront's Custom order page (describe it,
  attach an STL/GLB or photo, see it in 3D with an instant price range), My requests, quote
  acceptance through the same order form as checkout (an order awaiting the deposit), decline,
  cancel; the dashboard inbox with design previews (designers) and quotes (staff). Status
  history is written by a database trigger, like orders. Quote validity (7 days), refundable
  deposit, upload limit (50 MB) and the estimate rules are dashboard settings.
- **Theme control:** start from a palette, change any colour, live light/dark preview with the
  logo, readability checks; applied to every page at once; back to the default in one click.
- **Pricing** (costs, markup, rush, delivery, deposit, bulk discounts) and **exchange rates**
  (with who set each one).
- **Team:** add Workspace addresses as staff, **designer** or admin; switch access off.
- **Audit log** viewer, and **catalog import/export** (docs/CATALOG_IMPORT.md), also from the
  command line for the deployed site. The examples (with the new **designer collection**) are
  loaded through the same importer.
- **Production planner** (2026-10-28): print jobs per order with machine, material, grams and
  hours; scheduled jobs appear on the studio Google Calendar; finishing a job takes the material
  from stock.

Built first (owner's order, 2026-10-27):

1. **Products:** upload an STL or GLB, see it in 3D before publishing, pick a category and the
   options a customer can choose (colour, material, size…), each with its price effect.
2. **Store settings:** the money-transfer and WhatsApp numbers (today `+961 70 904 044`,
   changeable; the API and audit log already exist), later the payment QR code.
3. Orders pipeline (status changes use the shared flow, deposits marked as paid), custom
   requests inbox (see `docs/CUSTOM_REQUESTS.md`), leads.

Then: stock per material with low-stock alerts, production planner (calendar + kanban), pricing
settings, currencies and exchange rates, user/role management, audit log viewer.

**Theme control (owner request, 2026-10-27):** an admin page to pick the palette — any colour
combination — for the website and the logo, with a live preview and contrast checks (the same
WCAG tests the built-in palettes pass). Saved in the database and applied immediately to every
page and the logo, which already read their colours from CSS variables. `tokens.ts` stays the
default for a fresh install.

## Phase 11 — Back office: CRM, sales and accounting

The Odoo bridge is cancelled. Instead, Forgea gets its own back office, built inside this codebase with the same
feature-folder structure, shared packages and security model — no second system to sync.
The owner's existing Odoo codebase is used as the **functional reference** (what models, fields and flows a
small business needs), re-implemented in NestJS/Prisma, not copied.

- 11a. CRM: lead pipeline stages, activities, follow-ups; leads become quotes.
- 11b. Sales: quotations → confirmed orders (reuses Orders and `@forgea/pricing`), customer records.
- 11c. Accounting: chart of accounts, double-entry journal, customer invoices, payments (COD/transfer),
  deposits, reports (P&L, balance, receivables). Every posting append-only and audit-logged.
- **Multi-currency everywhere** (owner decision 2026-10-26): sales, invoices, payments, reports and the
  ledger use the `currencies` / `exchange_rates` tables already built. USD is the base; each document
  stores its own currency and the owner-set rate in force at its date; reports can show any currency.
- Built 2026-10-28 from Odoo 20 `crm`, `sale`, `sale_crm` and `account` as the reference (design in
  docs/BACK_OFFICE.md). Licensing: Odoo Community is LGPL-3 and Enterprise is proprietary, so no code
  was ported; models and flows are re-designed.
- Not yet: documents in other currencies (everything is posted in USD today; the tables are ready),
  supplier bills.

## Phase 13 — Deployment

Resumed 2026-10-28; design and every step in deploy/README.md. One Hostinger VPS runs staging and
production side by side with Docker Compose (owner's choice 2026-10-28), Cloudflare in front, the domain forgea-lab.com; GitHub
Actions tests, builds the images and deploys: `development` (daily work, tests only) → `staging` → `production`, each branch deploying to its environment.
Replaces the earlier Google Cloud plan (why: docs/SECURITY.md, first section).

Written, not yet run: Docker is not installed on the development machine yet, so the images
and the stack are verified the first time CI builds them and the first deploy runs.

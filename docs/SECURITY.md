# Security

How Forgea protects customer data, money and the business's internal numbers.
Report a vulnerability privately to the owner; do not open a public issue.

## What an attacker needs to reach the database

**Nothing they can get from the internet.** In production:

1. **The database has no address on the internet.** PostgreSQL runs in a container on an
   internal Docker network (`deploy/app/compose.yaml`, network `db`, `internal: true`): no port is
   published, and the network has no route in or out. There is nothing to connect to, scan or
   brute-force.
2. **Only the API (and the one-off migration job) is on that network.** The storefront and the
   front door (Caddy) are not, and have no database credentials.
3. **The API connects as `forgea_app`**, a least-privilege role that owns only the `forgea`
   database (`deploy/app/postgres-init.sh`). It is not a superuser.
4. **Passwords live only on the server**, in `/srv/forgea/<environment>/*.env` files readable by
   the `deploy` user alone (mode 600), different for staging and production. They are not in the
   code, the images, the repository or CI.
5. **The server itself:** SSH keys only (no passwords, no root login), fail2ban, automatic
   security updates (`infra/setup-server.sh`). The host's firewall (Hostinger) admits HTTPS from
   Cloudflare's addresses only, and SSH; every other port is closed before it reaches the server.
6. **Staging and production share the server, not their data.** Each has its own database,
   files, passwords and private networks; they meet only at the front door (Caddy's network),
   where a staging container could reach production's API only as any visitor could (it has
   none of production's secrets). Staging should sit behind Cloudflare Access (deploy/README.md).

So the realistic paths to the data are through the API itself, which is why the rest of this
document matters, or through the SSH keys of the owner or of GitHub Actions (stored as GitHub
secrets), which can deploy and therefore control the server.

**Why a server and not Google Cloud's managed services** (the earlier plan: Cloud SQL with a
private IP, Cloud Storage, Secret Manager, Cloud Run): decided 2026-10-28 for cost against
performance. One small server running both environments costs a fraction of a managed
database per environment, and the
points above keep the same guarantees: no public database address, private files served only
through the API's rules, secrets outside the code. What the owner takes on instead: the
server's updates (automatic) and backups (automatic, nightly, encrypted — `deploy/app/backup.sh`).

Locally the database runs on `localhost` with credentials in the gitignored `api/.env`.

## Signing in

| Who | How | Why |
|---|---|---|
| Admin, staff, designers | Google Workspace only (`@forgea-lab.com`) | 2FA is enforced by Workspace; no second, weaker way in |
| Customers | Google, or email + password, or both | Their choice; an account is needed to order |
| Visitors | No account | Browse and fill a cart; checkout asks them to sign in (the cart is kept) |

- **Staff can never have a password.** A database CHECK constraint refuses it, and the password
  login rejects non-customers with the same generic message as a wrong password.
- **Workspace accounts are checked twice:** the email domain, and Google's `hd` (hosted domain)
  claim, which only accounts managed by the organization carry. A Workspace address that no
  admin has set up is refused, never turned into a customer. The very first admin comes from
  `BOOTSTRAP_ADMIN_EMAIL`, and only while no admin exists.
- **Google sign-in** uses OpenID Connect via `openid-client` (a certified implementation) inside
  Passport: authorization-code flow with PKCE, state and nonce, and verified ID-token signatures.
- **Passwords** are hashed with argon2id (19 MiB, 2 iterations, OWASP minimum). Unknown emails
  are checked against a dummy hash so the response time doesn't reveal whether an account exists.
- **Account pre-hijacking is blocked:** if someone registers a victim's email with a password
  before the victim ever signs in with Google, that password is removed (and audit-logged) when
  Google proves the real owner.
- **Roles** (checked by the API on every call; the dashboard only hides what a role can't use):
  admins reach everything; **staff** run orders, production, custom-request quotes, leads,
  quotations, invoices and payments;
  **designers** run the catalog (products, 3D models, categories, options) and add design
  previews to requests, and can read materials but not change what they cost. Neither staff nor
  designers see pricing settings, exchange rates, the team, the audit log, catalog transfer,
  the books (accounts, manual entries, lock date, tax) or the financial reports.
- **The team is managed by address** (Dashboard → Team): an admin adds a Workspace address with
  a role; Google links it at the first sign-in. Customer accounts can never be given a team
  role, nobody can change their own access, and the last active admin can't be removed.
  **Switching someone off** ends all their sessions at once, refuses their next Google sign-in,
  and closes the dashboard for them immediately (`/auth/me` refuses them); any other API call
  stops when their last access token expires (≤ 15 minutes). Every change is audit-logged.
- **Email verification** (Phase 9): a new account gets a signed, single-purpose link
  (`/verify-email`); the address is marked confirmed when it is opened.
- **Known gap:** registering an already-used email still says so. Rate limiting bounds how fast
  anyone can probe; answering "check your email" in both cases is the next step.

## Sessions

- **Access token:** a JWT (HS256, pinned on verify, issuer and audience checked) valid for 15 minutes.
- **Refresh token:** a random 256-bit opaque string. Only its SHA-256 hash is stored.
  It rotates on every refresh; **presenting an old one revokes the whole login**, because only a
  thief would still hold it.
- **Both live in cookies that are** `HttpOnly` (scripts can't read them), `Secure` and
  `SameSite=Strict` (never sent on cross-site requests), for every sign-in method.
- Role changes take effect at the next refresh (at most 15 minutes).

## Every request

Global guards run in this order on every route:

1. **Rate limit** per client IP (see below).
2. **CSRF check** on every state-changing request: a custom `X-Forgea-CSRF: 1` header is
   required (HTML forms can't send one, and cross-origin scripts can't without a CORS preflight,
   which is refused), `Origin` must be on the allowlist when present, and `Sec-Fetch-Site:
   cross-site` is refused. This sits on top of the `SameSite=Strict` cookies.
3. **Authentication:** every route requires a signed-in user unless it is explicitly marked
   `@Public()`. A forgotten decorator fails closed.
4. **Roles:** `ADMIN` reaches everything; `STAFF` reaches routes marked for staff (orders and
   print jobs), never pricing settings or user management; `CUSTOMER` reaches only their own
   orders and cart, enforced by ownership checks in each service.

Also on every request:

- **Validation:** every body is a class-validator DTO; unknown fields are rejected (so nobody
  can add `"role": "ADMIN"` to a sign-up), types are enforced. The same DTO classes validate
  the website's forms (`@forgea/validation`).
- **Helmet headers**, with a `default-src 'none'` CSP, since the API only returns JSON.
- **CORS allowlist:** `https://forgea-lab.com` and its https subdomains only (plus explicit
  localhost origins in development).

## The storefront talks to the API for the shopper

Browsers only ever talk to the storefront (forgea-lab.com). Its server calls the API on the
shopper's behalf (`web/app/lib/api-client.server.ts`), forwarding their cookies and relaying
the cookies the API sets. API addresses and tokens never reach browser code.

- **Shopper IP for rate limits:** every API call comes from the storefront server, so on its own
  every shopper would share one rate-limit bucket. The storefront forwards the shopper's IP
  (from Cloudflare's header, in production) together with `INTERNAL_PROXY_SECRET`; the API trusts
  the forwarded IP only when that secret matches (constant-time comparison).
- **Storefront CSRF:** React Router refuses cross-origin form posts itself (400), and the
  storefront's own middleware also refuses any `Origin` other than its own and any
  `Sec-Fetch-Site: cross-site` (403).
- **One session renewal per page:** loaders share one API client per request, so an expired
  access token is renewed once — parallel renewals would look like refresh-token theft.
- **Safe redirects after sign-in:** `?next=` accepts same-site paths only (`safeNext` in
  `@forgea/types`, used by both the storefront and the API's Google callback, which keeps the
  path in its short-lived OAuth cookie).

## Cart and checkout

- **Visitor carts** are identified by a cookie signed with `COOKIE_SECRET`; a forged or edited
  cookie is ignored, so nobody can read or change another visitor's cart. It is `SameSite=Lax` (it is not a
  credential); cart changes still need the CSRF header.
- **Prices are never taken from the browser.** Checkout re-prices every line from the database,
  converts with the admin's current rate, and rejects any extra field such as `total`.
- **Ordering needs an account** (owner decision, 2026-10-27): checkout answers 401 without a
  session. There is no public order lookup; customers follow orders in My orders, and each
  order belongs to exactly one account (`orders.userId` is NOT NULL).
- **Idempotent checkout:** each checkout page carries a one-time key; resubmitting returns the
  same order instead of creating a second one.
- **Order numbers** are `FG-` + 10 random Crockford base-32 characters (50 bits); the database
  rejects any other format. Random numbers mean an order number read out on the phone or
  WhatsApp reveals nothing about how many orders exist or which others are real.
- **Payment numbers** (money transfer, WhatsApp) are store settings only an admin can change,
  audit-logged with who changed them. Anyone who could edit them could redirect payments, so
  they are not a staff permission.

## Rate limits

| Route | Limit per IP | Why |
|---|---|---|
| Everything | 120/min, 3000/hour | Baseline |
| Sign-in, register, refresh | 5/min, 30/hour | Slows password guessing |
| Custom-design form | 3 per 10 min, 10/hour | Spam |
| Quotes, cart | 30/min and 60/min | Bounded work per client |
| Checkout | 5/min, 20/hour | A person places a few orders at most |

Rate-limit counters are kept in the API's memory; each server runs one API, so they are exact
(they reset when it restarts, e.g. on a deploy).

**Client IPs** come from Cloudflare's `CF-Connecting-IP` header only when `TRUST_CLOUDFLARE` is
on. It is on for the servers, whose firewall admits only Cloudflare, so nobody else can set
that header; anywhere else it must stay off.

**The API has no public address.** The storefront calls it inside the server's Docker network;
from the internet only the two Google sign-in paths reach it, through Caddy on the site's own
host (`deploy/edge/Caddyfile`). Sign-in cookies therefore belong to that one host (no shared
cookie domain), so staging and production never see each other's sessions.

## File uploads

1. **Size caps** are enforced while the upload streams in (10 MB images, 100 MB models; customers'
   request files up to the owner's limit, 50 MB to start, never over 100 MB).
2. **The real type is read from the file's bytes**, never from its name or the browser's
   Content-Type. Only PNG, JPEG and WebP images, and GLB and STL models, are accepted. **SVG is
   refused**: it can contain scripts.
3. **Quarantine first:** bytes land under `quarantine/` and are never served from there. Files
   that pass inspection move to `clean/` under a generated name; rejected files are deleted
   and the record is kept for the audit trail.
4. **The original filename is never used for storage** (path traversal is impossible); it is kept
   only for staff to read.
5. **Who may see a file:** a clean file is served to shoppers only while an active product shows
   it; until then (and after it is hidden) only staff see it, so a model uploaded for a product
   that isn't published yet stays private. Everyone else gets 404, as if it didn't exist.
   The API streams the file through the storefront (`/media/<key>`); the files sit on a
   private Docker volume that only the API mounts, and nothing serves them directly.
   Compressed copies of 3D models (`<id>.view.glb`, `<id>.lite.glb`) follow their original's rules.
6. Only admins and designers upload product files (`POST /uploads/product-model`,
   `/uploads/product-image`), and a product only accepts keys of clean uploads made for that
   purpose.
7. **Customers' files** (custom requests: STL, GLB or a photo) are visible only to the customer
   who uploaded them and to the team; a request only accepts its own customer's uploads. The
   studio's design preview is visible to that request's customer and the team. Responses for
   signed-in viewers are `Cache-Control: private`, so shared caches never keep someone's file.
8. **Instant estimates** are computed by the API from the stored file itself (volume, the
   material's density and speed, the owner's settings), never from numbers sent by the browser.
9. **Catalog import** (admins, or the server-side script) checks every entry with the dashboard's
   own rules and sends every file in it through this same quarantine and inspection.

**Not yet done (Phase 7):** malware scanning and re-encoding images to strip embedded data. The
inspector is designed to take them as additional steps before a file is marked clean.

## Local dashboard preview (development only)

`pnpm dashboard` (and the browser tests) sign in a local admin without Google, using
`api/scripts/dev-admin-session.ts`. This is **not a login path**: the API and the website have
no route for it. The script needs direct access to the database and refuses to run when
`NODE_ENV=production` or when the database isn't on this machine. It only ever uses the
`BOOTSTRAP_ADMIN_EMAIL` account and never promotes an existing customer. In production, staff
still sign in only with Google Workspace.

## Audit log

Every sensitive admin/staff action writes an append-only `AuditLog` row: who, what, which
record, when, and the client IP. Routes opt in with `@Audit({ action, targetType })`, and the
entry is written before the response is sent, so a failed audit write fails the change. Staff
and admin sign-ins, the first-admin bootstrap and the pre-hijack password removal are logged.
There is no update or delete path for audit entries in the code.

## Books (accounting)

The database itself enforces the ledger, not only the code: a posted entry and its lines can't
be changed or deleted (a trigger refuses it), every posted entry must balance (a deferred
constraint trigger checks debits = credits at commit), and nothing can be posted on or before
the lock date, which only moves forward. Corrections are new entries or credit notes. Invoices,
payments and manual entries record who posted them.

## Google service account

Gmail and Calendar use one service account with domain-wide delegation limited to the
`gmail.send` and `calendar.events` scopes, acting only as `MAIL_SENDER`. Its key is a secret
(the server's `api.env` in production, `api/.env` locally); no mailbox password exists anywhere. A
Workspace admin revokes it in one place.

## Site theme

The owner's palette is applied to every page as an inline `<style>`. Only a palette whose 18
values are all `#rrggbb` is stored (checked by the API) and written into the page (checked again
by the storefront), so nothing else can reach that style block. A palette that fails a
readability check (WCAG AA, light and dark) is refused unless the owner ticks "keep my colours
anyway" (the save is audit-logged); the editor also offers to fix it in one click.

## Pricing data

Cost settings (machine rate, waste, labor, markup) never leave the API; the browser gets only
the customer-facing order settings. The server always re-prices an order when it is placed and
never trusts a total sent by the browser.

## Secrets and dependencies

- **Production secrets** (database passwords, JWT and cookie secrets, Google OAuth client, the
  Google service account key, the backup password) live only on each server, in `/srv/forgea/*.env`
  (mode 600), different for staging and production. GitHub holds only the SSH keys used to deploy.
  Locally they live in the gitignored `api/.env`. The API refuses to start with a missing or weak
  secret, and in production also without Google sign-in or with non-https URLs.
- **Images** run as the unprivileged `node` user and contain only compiled code and production
  dependencies; `.dockerignore` keeps every `.env` file, upload and test out of the build.
- **CI fails on any high or critical vulnerability** (`pnpm audit --audit-level high`, the pnpm
  equivalent of `npm audit` for this lockfile). Fixes for transitive dependencies are forced
  with `overrides` in `pnpm-workspace.yaml` (currently `multer` ≥ 2.5.0, GHSA-q7qp-rjg7-q26m).
- **Install scripts are blocked** unless a package is explicitly approved in `allowBuilds`.
- **Exact pins** for security-relevant packages (Prisma, auth libraries).

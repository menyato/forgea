# Pricing and currencies

## Currencies

- **USD is the base currency.** Every price, cost and setting is defined in USD — how Lebanese
  shops price today ("fresh dollars").
- **Other currencies are converted at rates the owner sets** in the admin dashboard
  (`PUT /currencies/:code/rate`, admin only, audit-logged). Rates are an append-only history:
  each order, invoice and report uses the rate in force at its own time.
- **Each order stores** the currency the customer pays in, the rate used and the converted
  total, so cash-on-delivery in LBP is exact and later rate changes never rewrite old orders.
- **Cash rounding:** LBP amounts round half-up to the nearest LBP 5,000; USD to the cent.

| Currency | Decimals | Cash step | Default rate |
|---|---|---|---|
| USD (base) | 2 | 0.01 | 1 |
| LBP | 0 | 5,000 | 89,500 per USD (market rate, spring 2026) |

More currencies (e.g. EUR) are a row in the `currencies` table plus a rate — no code change.
Phase 11 (sales, invoices, accounting) builds on the same tables.

## Pricing defaults (Lebanon, USD)

Researched 2026-10-26; applied by migration `20261026180000_multi_currency`. All are
admin-editable (Phase 8); the migration only replaces values that still hold earlier defaults.

| Setting | Value | Basis |
|---|---|---|
| Material: PLA | $0.020 / g | Beirut retail $18–24 per kg (Cube 3D, 3DFactory LB, 3D Maker) |
| Material: PETG | $0.022 / g | Estimate: no Lebanese PETG listing found; priced slightly above PLA |
| Material: ASA | $0.025 / g | Estimate: no Lebanese ASA listing found |
| Machine rate | $1.50 / hour | Printer depreciation (~$0.42/h) + maintenance (~$0.10/h) + generator-era electricity and overhead |
| Purge / waste | 5 % | |
| Failure allowance | 8 % | Guides put experienced print farms at 5–10 % failures |
| Labor per unit | $1.50 | Support removal and light finishing |
| Packaging per unit | $0.75 | |
| Markup | × 1.6 | |
| Rush fee | 30 % | |
| Delivery | $5 | Greater Beirut couriers charge ~$3–6; other cities $5–10, rural $8–15 |
| Deposit on custom items | 50 % | Project brief |
| Bulk discounts | 5 % at 10, 10 % at 25, 15 % at 50 units | |

## What that gives

| Example | Inputs | Price (USD) | ≈ LBP |
|---|---|---|---|
| Keychain, PLA | 10 g, 0.75 h | **$6.00** | 535,000 |
| Phone stand, PLA | 60 g, 3 h | **$13.91** | 1,245,000 |
| Electronics enclosure, PETG | 150 g, 8 h | **$31.26** | 2,800,000 |

## The owner's own price

Whoever manages pricing may give a product its own price (`priceOverride`, the product's
price panel: "Use my own price"). The calculation stays beside it for reference, and unticking
goes back to it. A customer's choices still move the price by what they change in the
calculated price: own price + (calculated price of the choice − calculated price of the
product as it is), never below zero (`overriddenUnitPrice` in `@forgea/pricing`). So a bigger
size, a heavier option, an add-on or a longer personalised text still costs more.

## Parts customers recolour (3MF products)

A multi-colour product's colour rows may name a part ("Body", "Ears"). Customers then choose
that part's colour from the product's part colours (an option group with swatches). Each
colour is priced by its own add-on (`extraPrice`), added once per part in it; the part's grams
stay as the file says, so a colour's material price per gram is not applied to the part. The
part starts in its row's colour, so the shop's "from" price includes that colour's add-on.
Stock takes the part's grams from the colour chosen.

## Not verified / to decide

- No Lebanese studio publishes per-gram prices, so there is no direct local benchmark.
- Delivery is one flat fee for now. Zone pricing (Beirut / other cities / rural) fits the
  research better and can be added to checkout (Phase 5) if wanted.
- Labor, packaging and markup are business decisions, not market data.

## Sources

- Beirut filament prices: https://www.cube3dp.com/products/elegoo-pla-matte-filament,
  https://3dfactorylb.com/product-category/filaments/, https://www.3dmakerlb.com/store/categories/3d-filament
- Lebanon delivery: https://wakilni.com/, https://voxire.com/blog/ecommerce-shipping-delivery-lebanon-2026/,
  https://easyappsecom.com/guides/selling-on-shopify-lebanon
- USD/LBP rate: https://tradingeconomics.com/lebanon/currency
- Machine-rate and failure guidance:
  https://beancount.io/blog/2026/09/08/pricing-3d-printed-products-machine-time-failed-prints-post-processing-guide,
  https://siraya.tech/blogs/news/how-to-price-3d-prints

# Custom requests — exploration

How a customer asks for something made to order, sees an estimate, pays half, and talks to the
studio on WhatsApp. **Built in Phase 8b (2026-10-27)**: "Describe the idea" and "Upload a 3D
file" with the instant range are live (`/custom`, `/requests`, Dashboard → Custom requests);
templates are products with options (e.g. the name keychain). Designers can attach a 3D design
preview that the customer sees with the quote. Not built: 3MF uploads (STL and GLB only).

## What the customer does

```
 1. Start            2. Estimate             3. Quote               4. Pay half         5. Made
 ───────────         ────────────            ─────────              ──────────          ──────
 Upload a file   →   Instant price range  →  Studio confirms the →  Send 50% to the  →  Order moves
 or describe         and a 3D preview        exact price (and a     transfer number     through the
 the idea            (file only)             preview for ideas)     (deposit)           usual steps
                                                     ↕ WhatsApp chat about the request at any point
```

Three ways in, one page ("Custom order"):

| Way in | Who it suits | Estimate |
|---|---|---|
| **Upload a 3D file** (STL, 3MF) | People who have a model | Instant range, computed from the model's volume; studio confirms |
| **Describe the idea** (text, photos, sketch, size, budget) | Most people | None at first; studio replies with a quote, usually with a preview image or 3D model |
| **Customize a template** (e.g. the name keychain: text, colour) | Simple personal items | Exact price at once, with a live 3D preview |

All three end the same way: a **quote** the customer accepts with one tap, which creates a normal
order in *Awaiting deposit*. The existing checkout rules apply: 50% deposit by money transfer to the
studio's number, the rest on delivery or by transfer. Staff mark the deposit as paid in the
dashboard, which moves the order to *In production*; every change lands in the status history.

## WhatsApp

Every request and quote page has a **Chat on WhatsApp** button: a free `wa.me` link to the
studio's number with the request number already typed ("Hello Forgea! About request CR-…").
The customer sends photos or voice notes there; staff paste anything important into the request's
notes in the dashboard so the record stays complete.

Free links cannot send messages *to* the customer (e.g. "your quote is ready"). That needs the
WhatsApp Business Platform, which Meta bills per conversation; whether that is worth it is your
call later. Until then, the site emails the customer and staff can follow up from their own
WhatsApp.

## How the instant estimate works (file uploads)

1. The browser reads the STL/3MF, shows it in 3D (react-three-fiber, Phase 7) and measures it:
   size, and **volume** (sum of signed tetrahedra over the triangles; exact for a closed mesh).
2. The customer picks material, colour, quality (strength: light / standard / solid) and quantity.
3. Grams ≈ volume × material density × fill factor for the chosen quality; hours ≈ grams ÷ the
   printer's throughput for that quality. Both feed the **same pricing engine** as the shop
   (`packages/pricing`), so the estimate uses your real cost settings.
4. Shown as a **range** (e.g. "$18–24"), because supports, print orientation and wall thickness
   change the real numbers. The studio's quote is the binding price.
5. The server recomputes from the stored file. It never trusts the browser's numbers, and the
   file goes through the existing upload quarantine (type sniffing; STL and 3MF are added to the
   allowed types).

A slicer (PrusaSlicer or OrcaSlicer from the command line) would give near-exact grams and
hours, but it means running a heavy program on the server for every upload. It can be added
later as a background job if the range proves too rough.

## What gets built (when this phase starts)

- **Database:** `custom_requests` (number `CR-` + random characters like order numbers, owner
  account, way in, file key or description, chosen options, estimate snapshot, quoted price,
  status) with its own append-only status history, enforced by a database trigger like orders:
  *Submitted → Quoted → Accepted (creates the order) / Declined / Expired*.
- **Shared code:** an `estimateFromVolume` function in `packages/pricing` (pure, fully tested),
  used by the browser for the instant range and by the API for the stored estimate; request
  DTOs in `packages/validation`; status labels and flow in `packages/types`.
- **API:** create a request (signed-in customers, rate-limited, uploads quarantined), list mine,
  accept or decline a quote; staff: inbox, quote (price, note, optional preview file), status.
- **Storefront:** the "Custom order" page with the three ways in, "My requests" next to "My
  orders", quote page with Accept and WhatsApp buttons.
- **Dashboard:** requests inbox with the 3D preview, quote form, and "deposit received".

## Recommendation

Build **"Describe the idea"** first, together with the dashboard inbox: it serves the most
customers and needs no geometry code. Then **file upload with the instant range**, which reuses the
3D viewer from Phase 7. Then **templates**, starting with the keychain. Each step is usable on
its own.

## Owner decisions (2026-10-27)

- A quote expires after **7 days** without an answer.
- The deposit is **refundable** if the customer cancels before printing starts.
- Customers can upload files up to **50 MB**.
- Templates: the owner wants examples, and **every rule configurable in the dashboard**.

All four become dashboard settings (not constants in code), with these as their first values.
Templates reuse the product options already built in Phase 8a: a template is a product with a
text option (the name), colour and size options, and its own price rules — so new templates are
made in the dashboard, not in code. The seeded "Custom name keychain" is the first example.

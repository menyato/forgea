# Running Forgea day to day

How to record everything the studio does on forgea-lab.com, so stock, costs, money and history
stay right. Every screen is in the **Dashboard** (top bar, once signed in with your Forgea
Google account).

## 1. Set up once (and when something changes)

| What | Where | Why it matters |
|---|---|---|
| Your printers: name, watts, what it cost, the hours it lasts | Orders → Configuration → **Printers** (entered once, only there) | Print runs take their electricity and wear from the printer they ran on. |
| Which printer prices come from, and the electricity price | Settings → **Pricing** → Printer time | Every price counts that printer's wear (price ÷ hours) and power; change the printer and prices follow. |
| Default profit (a % of cost or a fixed amount) | Settings → **Pricing** | What the shop adds on top of the cost. |
| Filaments as bought (PLA Red, PETG Black…) | Catalog → Filament stock → **New filament** | Its colour (RGB) and its own price; spools come in later. |
| Materials (PLA, PETG…) | Catalog → Configuration → **Materials** | Density and print speed; a reel's own price wins over the material's. |
| Colours customers may choose | Catalog → Configuration → **Options** | Each colour: its swatch, its add-on price, and **Printed from filament** (the reel orders take it from). |
| Transfer and WhatsApp numbers | Settings → **Payment, requests & emails** | Shown to customers at checkout. |

## 2. Filament

**A supplier's bill** (several reels, maybe a discount): Catalog → Filament stock → **Vendor
bill**. One line per reel as it is sold ("Elegoo PLA Matte (White)"), its colour, how many
spools, the price of one. Type the bill's discount and where you paid from (cash box or
transfer). Every reel goes on the shelf at what it really cost (the discount shared by price),
and the bill is booked once in the accounts.

**One reel, or a free one:** Filament stock → **Spools received**. For a gift, enter what it is
worth as the price and choose **Not booked**: it counts in costs, not in your spending.

**A material you never had:** in either form, Material → **A new material…**.

**Counting the shelf:** Filament stock → **Weigh the spools**: type what the scale says; the
difference is recorded with your note.

**A reel you no longer sell:** open it and untick **Track this filament**.

## 3. A product for the shop

1. Catalog → **Products** → New product. Name, description, category, material.
2. **3D model:** upload what customers see. An assembled piece: the assembly file. A sliced
   `.gcode.3mf` is read as soon as it is uploaded and fills a new product in by itself: grams,
   time, size, colours, the material the file prints in, and each colour's **Printed from**
   set to the closest reel on your shelf (check them; change any that are wrong).
3. **Print files:** add each sliced file (Bambu Studio: slice, then File → Export → **Export
   plate sliced file**, a `.gcode.3mf`). The panel shows each file's grams per colour, time
   and set-up. Click **Use the totals**: grams, time and colours fill in, purge, prime tower and
   supports counted.
4. **Colours:** for each colour, **Printed from** your reel (cost and stock follow it). Tick
   **Customers choose this colour** (or every colour) to let them recolour that part; the
   colour group under it is what they choose from (pick the one whose colours are linked to
   your reels, e.g. Showcase colours). **Starts as** under each part is the colour the shop
   shows first, in 3D and in the "from" price; left on automatic it is the choice printed from
   the same reel, else the closest colour.
5. **Price:** the panel shows cost (filament, printer wear, electricity, failures, labour,
   packaging), profit and the price. **Use my own price** to set yours: options still add to it.
6. Leave **Visible in the shop** off until it is ready; a product not in the shop can still be
   sold on a quotation.

## 4. Selling

**Shop orders** arrive in Orders → **Orders**. Open one: the figures at the top show its
filament, print time, cost to make and profit; the buttons under "Next step" move it on
(Confirm → Start production → Ready → Delivered). **Start production** takes each colour's
grams from its reel. The order page has a download for every sliced file.

**A sale you make yourself** (a walk-in, WhatsApp, a client's piece): Sales → **Quotations** →
New. Pick the product (hidden ones say "not in the shop") or write a free line; **Unit price**
is yours to change, higher or lower than the shop's: profit follows what you charge. Then
**Send** it (the customer accepts online) or **Confirm: create the order** yourself.

**Getting paid:** the order's **Invoices** panel: post the invoice, then **Record the payment**
(cash or transfer). The Business page and the books follow.

**Custom requests** (customers send a file or an idea): Orders → **Custom requests**. A file is
priced as the shop prices a product (the same costs, profit and reels: each of its colours at
the reel of that colour), and customers see a range around that price (your spread, Payment,
requests & emails). A sliced file uses the slicer's own grams and time and, if you allow it, is
quoted at once at the price itself; customers never see your costs. Otherwise send your quote
from the request.

## 5. Printing for the studio (tests, gifts, display pieces)

- **A product:** Filament stock → **Printed for the studio**. Grams and cost come from it; a
  piece whose parts customers recolour gets a colour per part (each from its own reel). Tick
  **Keep them on the shelf to sell** and they land in **Ready pieces** at what they cost.
  Pieces made before (or elsewhere): Ready pieces → **Add pieces by hand**, where a product's
  cost fills in from its grams and time.
- **Anything else:** a quotation at $0 to `hello@forgea-lab.com` with one free line per piece,
  **Confirm**, **Start production**. Each line gets a print run: open it (Orders →
  **Production**), choose the printer and the reel, then **Printing** and **Done** with the
  grams and hours the slicer gave. A piece in several filaments: **Plan another print for this
  order** for each other reel (its hours 0, so time counts once). The order's figures show
  what it took and what it cost.
- **A print that failed:** Filament stock → **Failed print** (a product), or **Failed** on its
  print run: the filament is counted as lost.

## 6. Checking

- **Business** (Accounting): revenue, estimated production cost and profit for any period.
- **Filament stock**: what is left per reel, what to buy and when.
- **Production results**: what was made, lost and left on the shelf.
- **Audit log** (Settings): who changed what.

## 7. Removing things

Each record's page has **Delete…** at the bottom (products, categories, materials, options and
their choices, filaments, printers, leads, lost reasons, stages), and their lists let you tick
several rows and press **Delete…**. Before anything goes, a window shows each record: what goes
with it (a product's sizes, colours and cart lines; a lead's notes), what stops pointing at it
(a colour "printed from" a deleted reel), and what keeps it (an order, a stock movement, a print
run…) with what to do instead, usually switching it off. **Keep them** leaves everything as it
is; **Delete** removes only the ones nothing keeps.

**Two accounts for one customer** (a second walk-in address): open the one to remove
(Customers), and at the bottom **Merge into another customer** (admins): type the email to
keep, tick, Merge. Its orders, quotations, requests, leads, invoices and payments become the
other's with their history, and the duplicate is removed. Studio work for itself goes on the
studio's own customer, hello@forgea-lab.com. Orders, quotations and custom requests are never deleted:
they are **cancelled**, so their history stays.

## 8. Safety

- A backup is taken every night and before every update (Settings → **Backups**: download
  copies to your PC from time to time).
- Updates reach the site only after every test passes on staging first.

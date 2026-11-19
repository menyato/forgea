# Running Forgea day to day

How to record everything the studio does on forgea-lab.com, so stock, costs, money and history
stay right. Every screen is in the **Dashboard** (top bar, once signed in with your Forgea
Google account).

The Dashboard opens on **Needs attention**: what is waiting (orders to confirm, requests to
quote, unpaid invoices, low stock…), each card opening its list. The row of buttons above the
cards starts the everyday jobs in one click: New quotation, New lead, Plan a print run, Printed
for the studio, Failed print, Spools received, Vendor bill, New product.

## 1. Set up once (and when something changes)

| What | Where | Why it matters |
|---|---|---|
| Your printers: name, watts, what it cost, the hours it lasts | Orders → Configuration → **Printers** (entered once, only there) | Print runs take their electricity and wear from the printer they ran on. |
| Which printer prices come from, and the electricity price | Settings → **Pricing** → Printer time | Every price counts that printer's wear (price ÷ hours) and power; change the printer and prices follow. |
| Default profit (a % of cost or a fixed amount) | Settings → **Pricing** | What the shop adds on top of the cost. |
| What prices round to ($1.00: whole dollars) | Settings → **Pricing** → Your profit | $4.70 sells at $5, $4.40 at $4. Set 0.01 to keep cents. |
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

A saved product's page opens the parts it uses and folds the rest to one line each (Print
files, Photos, Personalised text, Size, each saying what it holds): click a title to open it.
**Save product** stays at the bottom of the screen wherever you are on the page.

1. Catalog → **Products** → New product. The **Steps** at the top tick off as you go (model,
   name, grams and time, a reel for each colour, shop or hidden); each opens its panel. The
   colours it starts in show under the model (**Shown in**), and in the products list.
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
   **Add an extra cost** for parts besides the print (a key ring, a lamp's cable and bulb
   holder): it counts in what one piece costs you, so your profit applies to it too.
6. Leave **Visible in the shop** off until it is ready; a product not in the shop can still be
   sold on a quotation. Tick **Studio only (never sold)** for private pieces and tests (the car
   logos): they are printed and costed, but never shown, quoted or ordered.
7. **A name or a logo on it** (any product with an STL or 3MF model): the **Text and logos**
   section. Choose **Colours they print in** (a colour option with swatches), then **Add text**
   or **Add a logo**. Put each one on a side (**Front**, **Back**, **Left**, **Right**, **Top**)
   or press **Place it where I click** and click the model; **Turn it** turns it a quarter.
   Set its height, widest size, how far it stands out and its colour. Tick **Customers may
   change it** to let them type their own name, pick a font and a colour, or turn the logo
   off; without the tick it always prints as you set it. The 3D view shows it as it prints,
   and the price counts its filament. On an order, **Download with their text (3MF)** gives
   the model with the customer's name already in place, a part per colour.

**Logos** (Catalog → Configuration → **Logos**): add a logo as an SVG file (export it from
Illustrator, Inkscape, Canva or Figma). Everything drawn prints solid; shapes inside shapes are
holes. Switch one off to stop offering it (orders keep it).

**Name keychains**: in **Personalised text**, a keychain can offer **shapes** (a rounded tag, an
oval, a heart) and **logos** beside the name; customers pick them on the product page.

## 4. Selling

**Shop orders** arrive in Orders → **Orders**. Open one: the figures at the top show its
filament, print time, cost to make and profit; the buttons under "Next step" move it on
(Confirm → Start production → Ready → Delivered). **Start production** takes each colour's
grams from its reel. The order page has a download for every sliced file. Before production,
"What it takes to make" checks each filament against the shelf: **⚠** marks a colour with no
reel (buy it, or link the shop colour to a reel you have) or with too little left.

**A sale you make yourself** (a walk-in, WhatsApp, a client's piece): Orders → **New order**
(or the Dashboard's **New order** button). Fill in who it is for and the lines, press **Create the
order**: it opens as the order. To send a price first instead: Sales → **Quotations** →
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
  The same from Ready pieces → **Printed to sell**: the product shows with its model and the
  colours it starts in; choose each part's colour and the filament comes off those reels.
  Pieces made before (or elsewhere): Ready pieces → **Add pieces by hand** (no filament taken),
  where a product's cost fills in from its grams and time.
- **Anything else:** a quotation at $0 to `hello@forgea-lab.com` with one free line per piece,
  **Confirm**, **Start production**. Each line gets a print run: open it (Orders →
  **Production**), choose the printer and the reel, then **Printing** and **Done** with the
  grams and hours the slicer gave. A piece in several filaments: **Plan another print for this
  order** for each other reel (its hours 0, so time counts once). The order's figures show
  what it took and what it cost.
- **A print that failed:** Filament stock → **Failed print** (a product), or **Failed** on its
  print run: the filament is counted as lost.
- **Printed on:** both forms take the day it really came off the printer (today by default).
- **Still printing:** tick it and nothing comes off the shelf yet; the print waits on **Where
  it is** as *Printing*. When it comes off, open it there: **It is done** takes its filament,
  **Failed** (how far it got) counts it as lost.

**Where it is** (Orders → Where it is) shows everything printed, as cards in columns:
Printing, In the lab, In the shop, With someone, Given, Sold, Failed. Studio prints, failed
prints and every order line whose print run is done arrive by themselves (a paid order's
pieces as *Sold* to its customer). Drag a card to move it; *With someone*, *Given* and *Sold*
open its page to say who, by name and, when they have one, their account (a customer, or the
photographer or designer of the team): then the piece shows on their page too. The page also
corrects its name, how many, the note (e.g. "1 black and white, 1 white and light brown") and
the day it was printed. Filter by stage or by the days printed (this month, last month, any two
days); the line above says how many pieces, grams and cost that is. Every move is kept with who
made it, and an order's page shows where its pieces are.

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

**A test order that never happened** (admins only): at the bottom of its page, **Remove this
test order** lists what goes with it (its lines, print runs, filament records, pieces, and its
invoices, credit notes and the payments matched to them); type its number and press **Remove**.
The shelf gets its grams back. It refuses an order made from a quotation or a custom request,
or one whose payment also paid something else. Its document numbers are not reused.

## 8. Safety

- A backup is taken every night and before every update (Settings → **Backups**: download
  copies to your PC from time to time).
- Updates reach the site only after every test passes on staging first.

# Moving the catalog: export and import

The whole catalog — materials, categories, options with their price rules, and products with
their 3D models and photos — fits in one JSON file. Use it to move what you built locally to the
deployed site, to back the catalog up, or to load a catalog prepared elsewhere.

Orders, customers, stock levels, settings and the team are never in the file.

## From the dashboard

**Dashboard → Import & export** (admins only):

- **Download the catalog** — the export file, named `forgea-catalog-<date>.json`.
- **Import** — choose a file, then what happens to things that already exist:
  - *Keep it; only add what's missing* (the safe default): nothing you changed is touched.
  - *Replace it with the file's version*: matching entries are overwritten by the file.

Nothing is ever deleted by an import. Every export and import is in the audit log.

## From the command line (large files, or the first load of a new server)

```sh
pnpm build
pnpm --filter @forgea/api catalog:import path/to/forgea-catalog.json            # add missing
pnpm --filter @forgea/api catalog:import path/to/forgea-catalog.json --update   # also replace
```

It imports into the database `DATABASE_URL` points at — on the deployed site, the production
database — through exactly the same code as the dashboard, and records the import in the audit
log.

## How entries are matched

Never by database id, so one file works on any installation:

| Entry | Matched by |
|---|---|
| Material | `code` (e.g. `PLA`) |
| Category | `slug` (its web address) |
| Option group | `name` (e.g. `Colour`) |
| Option value | its `label` inside the group |
| Product | `slug` |

Importing the same file twice changes nothing. Files are stored once: a model or photo whose
bytes are already on the server is reused.

## What is checked

Every entry goes through the same rules as the dashboard's forms (the shared DTOs) and the same
services: prices and multipliers, a default that is offered, at most one option that switches
the material, and so on. Every 3D model and photo goes through the upload quarantine and is
checked from its bytes (STL or GLB for models; PNG, JPEG or WebP for photos).

The first problem stops the import and says where it is, e.g.
`products[3] "twist-vase": grams: …`. Entries before it were imported; fix the file and import it
again (that is safe).

Material **stock** is this installation's own: new materials start at 0 g, existing ones keep
theirs.

## The format

```jsonc
{
  "format": "forgea-catalog",
  "version": 1,
  "materials": [
    { "code": "PLA", "name": "PLA", "pricePerGram": "0.035", "densityGPerCm3": "1.24",
      "gramsPerHour": "12", "active": true }
  ],
  "categories": [
    { "slug": "designer", "name": "Designer collection", "description": null,
      "sortOrder": 0, "active": true }
  ],
  "optionGroups": [
    { "name": "Colour", "kind": "CHOICE", "maxLength": null, "textExtraPrice": "0",
      "sortOrder": 1, "active": true,
      "values": [
        { "label": "Sand", "swatchHex": "#d8c3a0", "gramsMultiplier": "1",
          "hoursMultiplier": "1", "extraPrice": "0", "material": null,
          "sortOrder": 0, "active": true }
      ] },
    { "name": "Name on it", "kind": "TEXT", "maxLength": 12, "textExtraPrice": "1.00",
      "sortOrder": 4, "active": true, "values": [] }
  ],
  "products": [
    { "slug": "twist-vase", "name": "Twist vase", "description": "…",
      "category": "designer", "material": "PLA", "grams": "95", "printHours": "7",
      "isCustom": false, "designer": "Forgea Studio", "active": true,
      "model": { "name": "twist-vase.stl", "base64": "…" },
      "images": [],
      "options": [
        { "group": "Colour", "required": true, "values": ["Sand", "Black"], "default": "Sand" }
      ],
      "size": { "x": "9.0", "y": "9.0", "z": "18.0" },
      "sizes": [
        { "label": "Small", "size": { "x": "6.8", "y": "6.8", "z": "13.5" },
          "grams": "40.08", "printHours": "2.95", "default": false },
        { "label": "Standard", "size": { "x": "9.0", "y": "9.0", "z": "18.0" },
          "grams": "95.00", "printHours": "7.00", "default": true }
      ] }
  ]
}
```

Money and measurements are strings (`"12.50"`), so no rounding happens on the way. `size` is
the printed size in cm (width, depth, height) that `grams` and `printHours` are for; `sizes` are
the real sizes a product is sold in, each with its own measurements, grams and hours (both are
optional, so older files still import). `material`
on an option value is the code of the material it switches to. Files are base64 inside the
JSON; a catalog with many large models can be hundreds of MB, in which case use the command
line.

The development examples (`api/prisma/example-catalog.ts`, loaded by `db:seed`) are written in
this format and loaded through the same importer.

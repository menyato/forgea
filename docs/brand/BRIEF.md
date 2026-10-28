# Forgea — logo brief and concept exploration

Method: `logo-design` skill (discovery → research → longlist → build → test). Fast track: no interview;
assumptions stated below for the owner to correct.

## Brief

- **Name:** Forgea (Forge + idea). Tagline from the owner's board: *3D printing · designing · customization*.
- **What:** a design-and-make studio in Lebanon. Custom design, 3D printing, and electronics built into the
  printed parts — the combination is the differentiator. Plus an online shop.
- **Audience:** people and businesses in Lebanon who want something made for them: gifts, parts, prototypes.
  Prices in USD, with LBP alongside.
- **Adjectives (assumed):** crafted, bold, precise, playful, local.
- **Must work:** 16 px favicon, one colour, reversed on dark, beside an interactive 3D website, and later next
  to Arabic script.
- **Keep:** the owner's current concept (F + plate + bar + coral square) stays as option 0.

## Category research (library of 1,432 real logos, 224 in maker/hardware/design)

| Convention | Share | Use? |
|---|---|---|
| Isometric 3D cubes | 90 / 224 | Avoid; it's the category default |
| Hexagons | 47 / 224 | Avoid |
| Blue as primary colour | most common family | Avoid |
| Nozzles, filament spools, layer stripes | common in 3D-printing shops | Avoid literal use |

## Longlist (one sentence each)

1. **F in motion:** a monoline F whose middle arm is still being printed: a gap, then the nozzle dot.
2. **Extruded F:** a flat F pulled into depth like a CAD extrude, the depth face in the accent colour.
3. **Layered wordmark:** FORGEA built from stacked slabs with hairline gaps. *(Too close to layer-stripe cliché.)*
4. **Anvil F:** an anvil silhouette with an F cut from negative space. *(Anvil reads as T; too clever.)*
5. **Custom module:** an F built from square modules, with one module lifted and coloured: "one piece made yours".
6. **Spark corner:** a solid square with one corner cut away into a four-point spark: the idea striking the object.
7. **Bracket F:** two hardware L-brackets bolted into an F. *(Literal.)*
8. **fg ligature:** lowercase f and g sharing a stroke, the g tail curling like filament. *(Weak at 16 px.)*
9. **Build plate (current):** the F standing on a grey plate, crossed by the bar, with the coral square.
10. **Carved block:** an F carved from one solid block, the cut-away piece set beside it.
11. **Trace F:** one line that is both a PCB trace (45° routing, solder pads) and a nozzle toolpath.
12. **Print meets circuit:** a stem of stacked print layers with circuit-trace arms ending in pads.

**Built (option 0 = current):** A = 1, B = 2, C = 5, D = 10, E = 11, F = 12.
Concept 6 (spark corner) was built and dropped: a four-point sparkle now reads as an "AI" icon.

**Test notes**

| Concept | 16 px | Notes |
|---|---|---|
| 0 Build plate | Plate and bar merge | Needs the separate mark (logo-mark.svg) for small sizes |
| A F in motion | Good | Nozzle dot can read as a full stop |
| B Extruded F | Best | Strongest "3D" read; the depth face carries the accent |
| C Custom module | Busy | Needs a simplified small-size cut |
| D Carved block | Good | Accent piece moved clear of the stem so it never reads as an E |
| E Trace F | Good | Strongest electronics + printing story in one stroke |
| F Print meets circuit | Stripes merge | Needs a simplified small-size cut |

## Palettes

All five live in `packages/brand/src/palettes.ts`. Switching is one word in `tokens.ts`.
Each passes the WCAG AA contrast tests in `palettes.test.ts`.

| Palette | Idea |
|---|---|
| `canva` (current) | The owner's board: ink, ash plate, graphite, coral |
| `kiln` | Forge heat on Doha sand: charcoal, sand, molten orange |
| `maroon` | Qatar's national maroon with pearl and warm stone |
| `resin` | Deep teal resin with a saffron accent |
| `copper` | Circuit-board copper on charcoal — printing + electronics |

## Limits

- No trademark search was done; run one before committing to a mark.
- Fonts used for the concept wordmarks are SIL Open Font License faces, outlined to paths (logo use allowed).

## Decision (2026-10-26)

The owner chose **option 0 (build plate, their original concept)** and left the colour to us: **copper**,
which ties the mark to the electronics side of the business. Fonts are still to be decided.
The other concepts were removed once the choice was made (2026-10-28).

import {
  type DesignSlot,
  SLOT_LIMITS,
  type SlotPlacement,
} from '@forgea/text3d/design';
import type {
  FontView,
  LogoDetail,
  OptionGroupView,
  ProductSlotsOffer,
} from '@forgea/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import { useSlotExtras } from '~/features/design-slots/use-slot-extras';
import {
  type ModelMeasurement,
  type ModelPick,
  ModelViewer,
} from '~/features/model-viewer/model-viewer';

type Box = ModelMeasurement['box'];
type FaceTools = Pick<
  typeof import('@forgea/text3d'),
  'faceAround' | 'inFrontAround'
>;
type Vec = [number, number, number];

/** Where text goes on each side of the model's box (the front faces the viewer: -Y). */
const SIDES: {
  key: string;
  label: string;
  place: (b: Box) => SlotPlacement;
}[] = [
  {
    key: 'front',
    label: 'Front',
    place: (b) => ({
      origin: [mid(b, 0), b.min[1], mid(b, 2)],
      normal: [0, -1, 0],
      up: [0, 0, 1],
    }),
  },
  {
    key: 'back',
    label: 'Back',
    place: (b) => ({
      origin: [mid(b, 0), b.max[1], mid(b, 2)],
      normal: [0, 1, 0],
      up: [0, 0, 1],
    }),
  },
  {
    key: 'left',
    label: 'Left',
    place: (b) => ({
      origin: [b.min[0], mid(b, 1), mid(b, 2)],
      normal: [-1, 0, 0],
      up: [0, 0, 1],
    }),
  },
  {
    key: 'right',
    label: 'Right',
    place: (b) => ({
      origin: [b.max[0], mid(b, 1), mid(b, 2)],
      normal: [1, 0, 0],
      up: [0, 0, 1],
    }),
  },
  {
    key: 'top',
    label: 'Top',
    place: (b) => ({
      origin: [mid(b, 0), mid(b, 1), b.max[2]],
      normal: [0, 0, 1],
      up: [0, 1, 0],
    }),
  },
];

const mid = (b: Box, axis: 0 | 1 | 2) => (b.min[axis] + b.max[axis]) / 2;
const round = (v: Vec): Vec => v.map((n) => Math.round(n * 100) / 100) as Vec;

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec): Vec => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The place's own flat frame: `r` along the text, `u` up the letters, `n` out of the surface. */
function frameOf(p: SlotPlacement) {
  const n = unit(p.normal);
  let u = p.up.map((v, i) => v - n[i]! * dot(p.up, n)) as Vec;
  if (Math.hypot(...u) < 1e-4) u = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  u = unit(u);
  return { r: unit(cross(u, n)), u, n };
}

/** The text's up turned by `degrees` about the face's normal (counter-clockwise as seen). */
function turned(p: SlotPlacement, degrees = 90): SlotPlacement {
  const { u, n } = frameOf(p);
  const a = (degrees * Math.PI) / 180;
  const side = cross(n, u);
  return {
    ...p,
    up: round(u.map((v, i) => v * Math.cos(a) + side[i]! * Math.sin(a)) as Vec),
  };
}

/** Moved `dx` mm along the text and `dy` mm up it, on its own face (the face it keeps). */
function moved(p: SlotPlacement, dx: number, dy: number): SlotPlacement {
  const { r, u } = frameOf(p);
  return {
    ...p,
    origin: round(p.origin.map((v, i) => v + r[i]! * dx + u[i]! * dy) as Vec),
  };
}

/**
 * Where the middle of its face is from it, along the text (x) and up it (y), mm; null without
 * a recorded face. The middle of the face's box, as an owner centres by eye.
 */
function faceCentre(p: SlotPlacement): { x: number; y: number } | null {
  const outer = p.face?.[0];
  if (!outer) return null;
  const { r, u } = frameOf(p);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 2 < outer.length; i += 3) {
    const d: Vec = [
      outer[i]! - p.origin[0],
      outer[i + 1]! - p.origin[1],
      outer[i + 2]! - p.origin[2],
    ];
    xs.push(dot(d, r));
    ys.push(dot(d, u));
  }
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** Up for a clicked face: the model's up, unless the face looks up or down (then its back). */
const upFor = (normal: Vec): Vec =>
  Math.abs(normal[2]) > 0.8 ? [0, 1, 0] : [0, 0, 1];

/**
 * Text and logos added to a product's model: each a "slot" the owner places (on a side of the
 * model, or where they click it), sizes and colours, and says whether customers may change it
 * (their name, font, colour; a logo on or off). Shown on the model as it will print.
 */
export function SlotsEditor({
  modelKey,
  name,
  value,
  onChange,
  groupId,
  onGroupId,
  groups,
  fonts,
  logos,
  errors,
}: {
  modelKey: string | null;
  name: string;
  value: DesignSlot[];
  onChange: (next: DesignSlot[]) => void;
  /** The colours slots print in (the product's part colours). */
  groupId: string;
  onGroupId: (id: string) => void;
  groups: readonly OptionGroupView[];
  fonts: readonly Pick<
    FontView,
    'id' | 'name' | 'fileKey' | 'latin' | 'arabic'
  >[];
  logos: readonly LogoDetail[];
  errors: Partial<Record<string, string>>;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const colourGroups = groups.filter(
    (g) => g.kind === 'CHOICE' && g.values.some((v) => v.active && v.swatchHex),
  );
  const colours = useMemo(
    () =>
      (groups.find((g) => g.id === groupId)?.values ?? [])
        .filter((v) => v.active && v.swatchHex)
        .map((v) => ({ id: v.id, label: v.label, swatchHex: v.swatchHex })),
    [groups, groupId],
  );
  const offer = useMemo<ProductSlotsOffer>(
    () => ({
      slots: value,
      logos: logos.map((l) => ({ id: l.id, outline: l.outline, inks: l.inks })),
      fonts: [...fonts],
      colours,
    }),
    [value, logos, fonts, colours],
  );
  const { extras, problem } = useSlotExtras(offer, {});
  const set = (id: string, patch: Partial<DesignSlot>) =>
    onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  // Stable, and only when the box changes: the viewer measures again whenever this changes.
  const onMeasured = useCallback((m: ModelMeasurement) => {
    setBox((old) =>
      old && JSON.stringify(old) === JSON.stringify(m.box) ? old : m.box,
    );
  }, []);
  // The flat face under a click is read with @forgea/text3d, loaded in the browser only.
  const [faceTools, setFaceTools] = useState<FaceTools | null>(null);
  useEffect(() => {
    let live = true;
    void import('@forgea/text3d').then((m) => {
      if (live)
        setFaceTools({
          faceAround: m.faceAround,
          inFrontAround: m.inFrontAround,
        });
    });
    return () => {
      live = false;
    };
  }, []);
  // Placing: press on the model and drag; the place follows the pointer and settles, with
  // the flat face under it, where it is let go (a click places it at once).
  const onDrag = useCallback(
    (pick: ModelPick, done: boolean) => {
      if (!placing) return;
      const slot = value.find((x) => x.id === placing);
      if (!slot) return;
      const normal = round(pick.normal);
      // The same way out of the surface: the text keeps the way it was turned.
      const sameFace = dot(unit(normal), unit(slot.placement.normal)) > 0.99;
      const placement: SlotPlacement = {
        origin: round(pick.origin),
        normal,
        up: sameFace ? slot.placement.up : upFor(normal),
      };
      // Its text and logo stay inside that face (nothing hangs off the edge of the print), and
      // clear of what stands in front of it (a trophy's sculpture before its board).
      const triangles = done && faceTools ? pick.triangles() : undefined;
      const face = triangles
        ? faceTools!.faceAround(triangles, placement)
        : undefined;
      const blocked =
        triangles && face
          ? faceTools!.inFrontAround(triangles, placement, face)
          : undefined;
      onChange(
        value.map((x) =>
          x.id === placing
            ? {
                ...x,
                placement: face
                  ? { ...placement, face, ...(blocked ? { blocked } : {}) }
                  : placement,
              }
            : x,
        ),
      );
      if (done) setPlacing(null);
    },
    [placing, value, onChange, faceTools],
  );

  if (!modelKey)
    return (
      <p className="text-sm text-text-muted">
        Upload the model first: text and logos are placed on it.
      </p>
    );

  const add = (kind: 'TEXT' | 'LOGO') => {
    const b = box ?? { min: [0, 0, 0], max: [40, 40, 40] };
    const smallest = Math.min(...[0, 1, 2].map((a) => b.max[a]! - b.min[a]!));
    const id = `${kind === 'TEXT' ? 'text' : 'logo'}-${Date.now().toString(36)}`;
    const slot: DesignSlot = {
      id,
      kind,
      label: kind === 'TEXT' ? 'Name' : 'Logo',
      editable: true,
      placement: SIDES[0]!.place(b as Box),
      heightMm: Math.max(5, Math.min(20, Math.round(smallest * 0.25))),
      maxWidthMm: Math.max(10, Math.round((b.max[0]! - b.min[0]!) * 0.8)),
      depthMm: 1,
      // New places centre themselves and keep clear of other text and parts of the model.
      centred: true,
      gapMm: SLOT_LIMITS.suggestedGapMm,
      colour: colours[0]?.id ?? '',
      ...(kind === 'TEXT'
        ? { defaultText: '', maxChars: 12, defaultFontId: fonts[0]?.id ?? '' }
        : {
            ...(logos.some((l) => l.active)
              ? { logoId: logos.find((l) => l.active)!.id }
              : {}),
            defaultOn: true,
          }),
    };
    onChange([...value, slot]);
  };

  const listError = Object.entries(errors).find(([k]) =>
    k.startsWith('slots'),
  )?.[1];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-text-muted">
        Add a name or a logo on the model. Put each one on a side, or press{' '}
        <strong>Place it on the model</strong>, then press on the model and drag
        it where you want it; the arrows move it a little at a time and{' '}
        <strong>Centre</strong> puts it in the middle of its face. Tick{' '}
        <strong>Customers may change it</strong> to let them type their own
        name, pick the font and colour, turn the logo off or add their own logo;
        the rest always prints as you set it.
      </p>
      <SelectField
        label="Colours they print in"
        name="slots-colour-group"
        value={groupId}
        onChange={(e) => onGroupId(e.currentTarget.value)}
        hint="An option group with swatches (Options page); customers choose from it too"
      >
        <option value="">Choose the colours…</option>
        {colourGroups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </SelectField>
      {/* Its own 3D view only once there is something to place (one model view is enough otherwise). */}
      {value.length > 0 && (
        <ModelViewer
          modelKey={modelKey}
          label={`${name || 'the product'} with its text and logos`}
          extras={extras}
          onMeasured={onMeasured}
          onDrag={placing ? onDrag : undefined}
          still
          className="max-h-[26rem] rounded-lg border border-border"
        />
      )}
      <p aria-live="polite" className="text-sm">
        {placing ? (
          <span className="font-medium text-accent">
            Press on the model where it should go and drag it into place.
          </span>
        ) : problem ? (
          <span className="text-danger">{problem}</span>
        ) : null}
      </p>
      {value.map((s) => (
        <fieldset
          key={s.id}
          className="grid gap-3 rounded-md border border-border p-4"
        >
          <legend className="px-1 text-sm font-semibold">
            {s.kind === 'TEXT' ? 'Text' : 'Logo'}: {s.label || '…'}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="What customers read above it"
              name={`slot-label-${s.id}`}
              autoComplete="off"
              value={s.label}
              onChange={(e) => set(s.id, { label: e.currentTarget.value })}
            />
            <SelectField
              label="Colour"
              name={`slot-colour-${s.id}`}
              value={s.colour}
              onChange={(e) => set(s.id, { colour: e.currentTarget.value })}
            >
              {colours.length === 0 && (
                <option value="">Choose the colours first</option>
              )}
              {colours.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </SelectField>
            {s.kind === 'TEXT' ? (
              <>
                <Field
                  label="Text it shows (customers may change it)"
                  name={`slot-text-${s.id}`}
                  autoComplete="off"
                  maxLength={40}
                  value={s.defaultText ?? ''}
                  onChange={(e) =>
                    set(s.id, { defaultText: e.currentTarget.value })
                  }
                  hint="Empty: nothing shows until a customer types"
                />
                <SelectField
                  label="Font"
                  name={`slot-font-${s.id}`}
                  value={s.defaultFontId ?? ''}
                  onChange={(e) =>
                    set(s.id, { defaultFontId: e.currentTarget.value })
                  }
                >
                  {fonts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </SelectField>
                <Field
                  label="Most characters"
                  name={`slot-chars-${s.id}`}
                  type="number"
                  min={1}
                  max={40}
                  autoComplete="off"
                  value={s.maxChars ?? 12}
                  onChange={(e) =>
                    set(s.id, { maxChars: Number(e.currentTarget.value) || 1 })
                  }
                />
              </>
            ) : (
              <>
                <SelectField
                  label="Logo"
                  name={`slot-logo-${s.id}`}
                  value={s.logoId ?? ''}
                  onChange={(e) =>
                    set(s.id, { logoId: e.currentTarget.value || undefined })
                  }
                  hint="Customers who may change it can also add their own logo here; add yours on the Logos page"
                >
                  <option value="">None: customers add their own</option>
                  {logos
                    .filter((l) => l.active || l.id === s.logoId)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </SelectField>
                <fieldset className="grid gap-1.5 sm:col-span-2">
                  <legend className="text-sm font-medium">
                    Customers pick from these logos
                  </legend>
                  <p className="text-xs text-text-muted">
                    Tick the logos they may choose for this place (the one above
                    is where it starts). None ticked: it is always the logo
                    above.
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {logos
                      .filter((l) => l.active || s.logoChoices?.includes(l.id))
                      .map((l) => (
                        <label
                          key={l.id}
                          className="flex items-center gap-1.5 text-sm"
                        >
                          <input
                            type="checkbox"
                            name={`slot-choice-${s.id}-${l.id}`}
                            checked={s.logoChoices?.includes(l.id) ?? false}
                            onChange={(e) => {
                              const on = e.currentTarget.checked;
                              set(s.id, {
                                logoChoices: on
                                  ? [...(s.logoChoices ?? []), l.id]
                                  : (s.logoChoices ?? []).filter(
                                      (x) => x !== l.id,
                                    ),
                              });
                            }}
                          />
                          {l.name}
                        </label>
                      ))}
                  </div>
                </fieldset>
                <CheckboxField
                  label="Shows until a customer turns it off"
                  name={`slot-on-${s.id}`}
                  checked={s.defaultOn ?? true}
                  onChange={(e) =>
                    set(s.id, { defaultOn: e.currentTarget.checked })
                  }
                />
              </>
            )}
            <Field
              label={s.kind === 'TEXT' ? 'Letter height (mm)' : 'Height (mm)'}
              name={`slot-height-${s.id}`}
              type="number"
              min={3}
              max={200}
              step={0.5}
              autoComplete="off"
              value={s.heightMm}
              onChange={(e) =>
                set(s.id, { heightMm: Number(e.currentTarget.value) })
              }
            />
            <Field
              label="Widest (mm)"
              name={`slot-width-${s.id}`}
              type="number"
              min={3}
              max={400}
              autoComplete="off"
              value={s.maxWidthMm}
              onChange={(e) =>
                set(s.id, { maxWidthMm: Number(e.currentTarget.value) })
              }
              hint="Longer text gets smaller to fit"
            />
            {s.placement.face && (
              <Field
                label="From the edge (mm)"
                name={`slot-edge-${s.id}`}
                type="number"
                min={0}
                max={30}
                step={0.5}
                autoComplete="off"
                value={s.edgeMm ?? SLOT_LIMITS.defaultEdgeMm}
                onChange={(e) =>
                  set(s.id, { edgeMm: Number(e.currentTarget.value) })
                }
                hint="It gets smaller to keep this far inside where it sits, e.g. inside a border"
              />
            )}
            {s.placement.face && (
              <Field
                label="Gap (mm)"
                name={`slot-gap-${s.id}`}
                type="number"
                min={0}
                max={30}
                step={0.5}
                autoComplete="off"
                value={s.gapMm ?? 0}
                onChange={(e) =>
                  set(s.id, { gapMm: Number(e.currentTarget.value) })
                }
                hint="From the text and logos above it in this list, and from parts of the model in front of it"
              />
            )}
            <SelectField
              label="On the surface"
              name={`slot-relief-${s.id}`}
              value={s.relief ?? 'RAISED'}
              onChange={(e) =>
                set(s.id, {
                  relief:
                    e.currentTarget.value === 'FLUSH' ? 'FLUSH' : 'RAISED',
                })
              }
              hint="Flush: set into the print, level with it, in its own colour"
            >
              <option value="RAISED">Raised above it</option>
              <option value="FLUSH">Flush (inlaid)</option>
            </SelectField>
            <Field
              label={
                s.relief === 'FLUSH' ? 'Depth into it (mm)' : 'Raised (mm)'
              }
              name={`slot-depth-${s.id}`}
              type="number"
              min={0.4}
              max={10}
              step={0.2}
              autoComplete="off"
              value={s.depthMm}
              onChange={(e) =>
                set(s.id, { depthMm: Number(e.currentTarget.value) })
              }
            />
          </div>
          {s.placement.face && (
            <CheckboxField
              label="Centred across where it sits"
              name={`slot-centred-${s.id}`}
              checked={s.centred ?? false}
              onChange={(e) => set(s.id, { centred: e.currentTarget.checked })}
              hint="In the middle of the free space on its row, wherever you placed it"
            />
          )}
          <CheckboxField
            label="Customers may change it"
            name={`slot-editable-${s.id}`}
            checked={s.editable}
            onChange={(e) => set(s.id, { editable: e.currentTarget.checked })}
            hint={
              s.kind === 'TEXT'
                ? 'Their own text, font and colour'
                : 'On or off, and its colour'
            }
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-muted">Put it on:</span>
            {SIDES.map((side) => (
              <Button
                key={side.key}
                variant="secondary"
                disabled={!box}
                onClick={() => set(s.id, { placement: side.place(box!) })}
              >
                {side.label}
              </Button>
            ))}
            <Button
              variant={placing === s.id ? 'primary' : 'secondary'}
              onClick={() => setPlacing(placing === s.id ? null : s.id)}
            >
              {placing === s.id ? 'Cancel placing' : 'Place it on the model'}
            </Button>
          </div>
          <PlaceControls
            id={s.id}
            label={s.label}
            placement={s.placement}
            onPlacement={(placement) => set(s.id, { placement })}
          />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Button
              variant="quiet"
              onClick={() => onChange(value.filter((x) => x.id !== s.id))}
            >
              Remove
            </Button>
          </div>
          <p className="text-sm text-text-muted">
            {s.placement.face
              ? 'Kept inside the face it sits on: longer text is made smaller, never off the edge.'
              : 'Place it where you click on the model to keep it inside that face.'}
          </p>
        </fieldset>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => add('TEXT')}
          disabled={value.length >= 8}
        >
          Add text
        </Button>
        <Button
          variant="secondary"
          onClick={() => add('LOGO')}
          disabled={value.length >= 8}
        >
          Add a logo
        </Button>
        {logos.length === 0 && (
          <Link to="/admin/logos/new" className="self-center text-sm underline">
            Add your logos (or leave the place to customers)
          </Link>
        )}
      </div>
      {listError && <p className="text-sm text-danger">{listError}</p>}
    </div>
  );
}

/**
 * Fine control of a place: arrows move it along its face (1 mm, or 0.2 mm when Fine), Centre
 * puts it in the middle of its face (across, up and down, or both), and it turns by 15° or 90°.
 */
function PlaceControls({
  id,
  label,
  placement,
  onPlacement,
}: {
  id: string;
  label: string;
  placement: SlotPlacement;
  onPlacement: (p: SlotPlacement) => void;
}) {
  const [fine, setFine] = useState(false);
  const step = fine ? 0.2 : 1;
  const centre = faceCentre(placement);
  const go = (dx: number, dy: number) => onPlacement(moved(placement, dx, dy));
  const arrow = (text: string, name: string, dx: number, dy: number) => (
    <Button
      variant="secondary"
      aria-label={`Move ${label} ${name}`}
      onClick={() => go(dx, dy)}
    >
      {text}
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-text-muted">Move:</span>
      {arrow('←', 'left', -step, 0)}
      {arrow('↑', 'up', 0, step)}
      {arrow('↓', 'down', 0, -step)}
      {arrow('→', 'right', step, 0)}
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          name={`slot-fine-${id}`}
          checked={fine}
          onChange={(e) => setFine(e.currentTarget.checked)}
        />
        Fine (0.2 mm)
      </label>
      <span className="ml-2 text-text-muted">Centre:</span>
      <Button
        variant="secondary"
        disabled={!centre}
        onClick={() => centre && go(centre.x, 0)}
      >
        Across
      </Button>
      <Button
        variant="secondary"
        disabled={!centre}
        onClick={() => centre && go(0, centre.y)}
      >
        Up and down
      </Button>
      <Button
        variant="secondary"
        disabled={!centre}
        onClick={() => centre && go(centre.x, centre.y)}
      >
        Both
      </Button>
      <span className="ml-2 text-text-muted">Turn:</span>
      <Button
        variant="secondary"
        aria-label={`Turn ${label} 15 degrees left`}
        onClick={() => onPlacement(turned(placement, 15))}
      >
        ↺ 15°
      </Button>
      <Button
        variant="secondary"
        aria-label={`Turn ${label} 15 degrees right`}
        onClick={() => onPlacement(turned(placement, -15))}
      >
        ↻ 15°
      </Button>
      <Button
        variant="secondary"
        aria-label={`Turn ${label} a quarter`}
        onClick={() => onPlacement(turned(placement, -90))}
      >
        ↻ 90°
      </Button>
    </div>
  );
}

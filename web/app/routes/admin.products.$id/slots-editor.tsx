import type { DesignSlot, SlotPlacement } from '@forgea/text3d/design';
import type {
  FontView,
  LogoDetail,
  OptionGroupView,
  ProductSlotsOffer,
} from '@forgea/types';
import { useCallback, useMemo, useState } from 'react';
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

/** The text's up turned a quarter about the face's normal (sideways text, then upside down…). */
function turned(p: SlotPlacement): SlotPlacement {
  const [nx, ny, nz] = p.normal;
  const [ux, uy, uz] = p.up;
  // n × u: a quarter turn of u about n.
  return {
    ...p,
    up: round([ny * uz - nz * uy, nz * ux - nx * uz, nx * uy - ny * ux]),
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
  const onPick = useCallback(
    (pick: ModelPick) => {
      if (!placing) return;
      const normal = round(pick.normal);
      onChange(
        value.map((s) =>
          s.id === placing
            ? {
                ...s,
                placement: {
                  origin: round(pick.origin),
                  normal,
                  up: upFor(normal),
                },
              }
            : s,
        ),
      );
      setPlacing(null);
    },
    [placing, value, onChange],
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
        <strong>Place it where I click</strong> and click the model. Tick{' '}
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
          onPick={placing ? onPick : undefined}
          className="max-h-[26rem] rounded-lg border border-border"
        />
      )}
      <p aria-live="polite" className="text-sm">
        {placing ? (
          <span className="font-medium text-accent">
            Click the model where it should go.
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
            <Field
              label="Raised (mm)"
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
              {placing === s.id ? 'Cancel placing' : 'Place it where I click'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => set(s.id, { placement: turned(s.placement) })}
            >
              Turn it ↻
            </Button>
            <Button
              variant="quiet"
              onClick={() => onChange(value.filter((x) => x.id !== s.id))}
            >
              Remove
            </Button>
          </div>
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

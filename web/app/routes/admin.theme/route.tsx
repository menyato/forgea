import {
  colorSchemes,
  defaultPaletteName,
  fixContrast,
  type Palette,
  PALETTE_KEYS,
  paletteChecks,
  palettes,
  schemeVariables,
  type SiteTheme,
} from '@forgea/brand';
import { SaveSiteThemeDto } from '@forgea/validation';
import { type CSSProperties, useState } from 'react';
import { data, useFetcher } from 'react-router';
import { Logo } from '~/components/brand/logo';
import { Button, buttonClass } from '~/components/ui/button';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<{ theme: SiteTheme | null }>('/site-theme');
  return { theme: r.ok ? r.data.theme : null };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  if (form.get('intent') === 'reset') {
    const r = await api.delete('/site-theme');
    return r.ok
      ? data<SaveResult>({ ok: true })
      : data<SaveResult>({ error: r.message }, { status: r.status });
  }
  return save(
    SaveSiteThemeDto,
    {
      palette: jsonField(form, 'palette'),
      basedOn: text(form, 'basedOn'),
      allowLowContrast: form.get('allowLowContrast') === 'on',
    },
    (dto) => api.put('/site-theme', dto),
  );
}

type Key = (typeof PALETTE_KEYS)[number];

/** The palette's colours, grouped and named by where they show. */
const GROUPS: { title: string; colours: [Key, string][] }[] = [
  {
    title: 'Light mode',
    colours: [
      ['paper', 'Page background'],
      ['white', 'Cards and panels'],
      ['ink', 'Text and logo'],
      ['graphite', 'Secondary text, logo bar'],
      ['ash', 'Borders, logo plate'],
      ['accent', 'Accent: buttons, logo square'],
      ['onAccent', 'Text on the accent'],
      ['accentDeep', 'Keyboard focus ring'],
    ],
  },
  {
    title: 'Dark mode',
    colours: [
      ['night', 'Page background'],
      ['nightRaised', 'Cards and panels'],
      ['nightBorder', 'Borders, logo plate'],
      ['mist', 'Text and logo'],
      ['stone', 'Secondary text, logo bar'],
      ['accentDark', 'Accent'],
      ['onAccentDark', 'Text on the accent'],
    ],
  },
  {
    title: 'Messages',
    colours: [
      ['green', 'Success'],
      ['amber', 'Warning'],
      ['red', 'Errors'],
    ],
  },
];

export default function Theme({ loaderData }: Route.ComponentProps) {
  const { theme } = loaderData;
  const [basedOn, setBasedOn] = useState(theme?.basedOn ?? defaultPaletteName);
  const [palette, setPalette] = useState<Palette>(
    theme?.palette ?? palettes[defaultPaletteName],
  );
  const [keepAnyway, setKeepAnyway] = useState(false);
  const save = useFetcher<SaveResult>();
  const reset = useFetcher<SaveResult>();
  const checks = paletteChecks(palette);
  const failing = checks.filter((c) => !c.passes);
  const schemes = colorSchemes(palette);

  return (
    <>
      <AdminHeader
        title="Theme"
        intro="The colours of the whole site and the logo, in light and dark mode. Start from a palette, change any colour, and check the preview. A palette is saved only when everything stays easy to read."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_28rem]">
        <div className="grid content-start gap-6">
          <Panel title="Start from">
            <div className="flex flex-wrap gap-2">
              {Object.entries(palettes).map(([name, p]) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={basedOn === name}
                  onClick={() => {
                    setBasedOn(name);
                    setPalette(p);
                  }}
                  className={`flex items-center gap-2 rounded-pill border px-3 py-1.5 text-sm capitalize ${
                    basedOn === name ? 'border-accent' : 'border-border'
                  }`}
                >
                  <span aria-hidden="true" className="flex">
                    {[p.ink, p.ash, p.accent].map((c) => (
                      <span
                        key={c}
                        className="h-4 w-4 rounded-full border border-border"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  {name}
                </button>
              ))}
            </div>
          </Panel>
          {GROUPS.map((g) => (
            <Panel key={g.title} title={g.title}>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.colours.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 text-sm">
                    <input
                      type="color"
                      value={palette[key]}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        setBasedOn((b) => (b === 'custom' ? b : 'custom'));
                        setPalette((p) => ({ ...p, [key]: v }));
                      }}
                      className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                    />
                    <span>
                      {label}
                      <span className="block font-mono text-xs text-text-muted">
                        {palette[key]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </Panel>
          ))}
        </div>

        <div className="grid content-start gap-6 xl:sticky xl:top-24 xl:self-start">
          <Panel title="Preview">
            <div className="grid gap-3">
              {(['light', 'dark'] as const).map((mode) => (
                <div
                  key={mode}
                  style={schemeVariables(schemes[mode]) as CSSProperties}
                  className="grid gap-3 rounded-lg border border-border bg-background p-4 text-text"
                >
                  <Logo
                    variant="compact"
                    className="block w-28 [&_svg]:h-auto [&_svg]:w-full"
                  />
                  <div className="grid gap-1 rounded-md bg-surface p-3">
                    <p className="font-display text-lg font-bold">Twist vase</p>
                    <p className="text-sm text-text-muted">
                      Six faces that turn from base to rim.
                    </p>
                  </div>
                  <span
                    className={buttonClass('primary', 'justify-self-start')}
                  >
                    Add to cart
                  </span>
                  <p className="text-sm">
                    <span className="text-success">Saved</span> ·{' '}
                    <span className="text-warning">Low stock</span> ·{' '}
                    <span className="text-danger">Payment failed</span>
                  </p>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Readability">
            <ul className="grid gap-1 text-sm">
              {checks.map((c) => (
                <li
                  key={c.mode + c.label}
                  className={c.passes ? '' : 'font-semibold text-danger'}
                >
                  {c.passes ? '✓' : '✗'} {c.label} ({c.mode}):{' '}
                  {c.ratio.toFixed(1)}:1
                  {!c.passes && `, needs ${c.required}:1`}
                </li>
              ))}
            </ul>
          </Panel>
          {failing.length > 0 && (
            <Panel title="Some text is hard to read">
              <p className="text-sm text-text-muted">
                Fix it in one click (only the colours marked ✗ above change, as
                little as possible), or keep your colours as they are.
              </p>
              <Button
                variant="secondary"
                className="justify-self-start"
                onClick={() => {
                  setBasedOn('custom');
                  setPalette(fixContrast(palette));
                }}
              >
                Fix the contrast for me
              </Button>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  form="theme-save"
                  name="allowLowContrast"
                  checked={keepAnyway}
                  onChange={(e) => setKeepAnyway(e.currentTarget.checked)}
                  className="mt-1"
                />
                Keep my colours anyway: I accept that some visitors will find
                this text hard to read.
              </label>
            </Panel>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <save.Form method="post" id="theme-save">
              <input
                type="hidden"
                name="palette"
                value={JSON.stringify(palette)}
              />
              <input type="hidden" name="basedOn" value={basedOn} />
              <Button
                type="submit"
                disabled={
                  (failing.length > 0 && !keepAnyway) || save.state !== 'idle'
                }
              >
                {failing.length > 0 && !keepAnyway
                  ? 'Fix the contrast, or keep it, to save'
                  : 'Save and apply'}
              </Button>
            </save.Form>
            {theme && (
              <reset.Form method="post">
                <input type="hidden" name="intent" value="reset" />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={reset.state !== 'idle'}
                >
                  Back to the default
                </Button>
              </reset.Form>
            )}
            <SaveStatus state={save.state} result={save.data ?? reset.data} />
          </div>
        </div>
      </div>
    </>
  );
}

import {
  colorSchemes,
  defaultPaletteName,
  fixContrast,
  type Palette,
  PALETTE_KEYS,
  type SavedThemeView,
  paletteChecks,
  palettes,
  schemeVariables,
  type SiteTheme,
} from '@forgea/brand';
import {
  ApplyThemeDto,
  SaveNamedThemeDto,
  SaveSiteThemeDto,
} from '@forgea/validation';
import { type CSSProperties, useState } from 'react';
import { data, useFetcher } from 'react-router';
import { Logo } from '~/components/brand/logo';
import { Button, buttonClass } from '~/components/ui/button';
import { Field } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [r, saved] = await Promise.all([
    api.get<{ theme: SiteTheme | null }>('/site-theme'),
    api.get<SavedThemeView[]>('/site-theme/saved'),
  ]);
  return {
    theme: r.ok ? r.data.theme : null,
    saved: saved.ok ? saved.data : [],
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  const intent = form.get('intent');
  const id = encodeURIComponent(text(form, 'id') ?? '');
  if (intent === 'keep') {
    return save(
      SaveNamedThemeDto,
      {
        name: text(form, 'name'),
        palette: jsonField(form, 'palette'),
        basedOn: text(form, 'basedOn'),
      },
      (dto) => api.post('/site-theme/saved', dto),
    );
  }
  if (intent === 'apply') {
    return save(ApplyThemeDto, {}, (dto) =>
      api.post(`/site-theme/saved/${id}/apply`, dto),
    );
  }
  if (intent === 'forget') {
    const r = await api.delete(`/site-theme/saved/${id}`);
    return r.ok
      ? data<SaveResult>({ ok: true })
      : data<SaveResult>({ error: r.message }, { status: r.status });
  }
  if (intent === 'reset') {
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
  // A new editor whenever the site's theme changes (saved, switched, back to the original),
  // so it always starts from what the site shows now, never from leftover edits.
  // The forms' results live here, so "Saved" outlasts the editor being rebuilt.
  const fetchers = {
    save: useFetcher<SaveResult>(),
    reset: useFetcher<SaveResult>(),
    keep: useFetcher<SaveResult>(),
    act: useFetcher<SaveResult>(),
  };
  return (
    <ThemeEditor
      key={loaderData.theme?.updatedAt ?? 'original'}
      {...loaderData}
      fetchers={fetchers}
    />
  );
}

type Fetchers = Record<
  'save' | 'reset' | 'keep' | 'act',
  ReturnType<typeof useFetcher<SaveResult>>
>;

function ThemeEditor({
  theme,
  saved,
  fetchers,
}: {
  theme: SiteTheme | null;
  saved: SavedThemeView[];
  fetchers: Fetchers;
}) {
  const [basedOn, setBasedOn] = useState(theme?.basedOn ?? defaultPaletteName);
  const [palette, setPalette] = useState<Palette>(
    theme?.palette ?? palettes[defaultPaletteName],
  );
  const [keepAnyway, setKeepAnyway] = useState(false);
  const { save, reset } = fetchers;
  const checks = paletteChecks(palette);
  const failing = checks.filter((c) => !c.passes);
  const schemes = colorSchemes(palette);

  return (
    <>
      <AdminHeader
        title="Theme"
        intro="The colours of the whole site and the logo, in light and dark mode. Start from a palette, change any colour, and check the preview. A palette is saved only when everything stays easy to read."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]">
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
                      name={`colour-${key}`}
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
                  Back to the original colours
                </Button>
              </reset.Form>
            )}
            <SaveStatus state={save.state} result={save.data ?? reset.data} />
          </div>
          <SavedThemes
            saved={saved}
            palette={palette}
            basedOn={basedOn}
            fetchers={fetchers}
            onOpen={(t) => {
              setBasedOn(t.basedOn);
              setPalette(t.palette);
            }}
          />
        </div>
      </div>
    </>
  );
}

/** Themes kept under a name: keep the editor's colours, switch the site to one, or remove it. */
function SavedThemes({
  saved,
  palette,
  basedOn,
  fetchers: { keep, act },
  onOpen,
}: {
  saved: SavedThemeView[];
  palette: Palette;
  basedOn: string;
  fetchers: Fetchers;
  onOpen: (theme: SavedThemeView) => void;
}) {
  return (
    <Panel title="Saved themes">
      <p className="text-sm text-text-muted">
        Keep the colours above under a name, then switch the whole site to any
        of them in one click. Customers see the switch on the next page they
        open.
      </p>
      <keep.Form
        method="post"
        key={keep.data?.ok ? 'kept' : 'form'}
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="intent" value="keep" />
        <input type="hidden" name="palette" value={JSON.stringify(palette)} />
        <input type="hidden" name="basedOn" value={basedOn} />
        <Field
          label="Name"
          name="name"
          required
          maxLength={60}
          hint="The same name replaces that theme"
          error={keep.data?.errors?.['name']}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={keep.state !== 'idle'}
        >
          Save these colours as a theme
        </Button>
        <SaveStatus state={keep.state} result={keep.data} />
      </keep.Form>
      {saved.length > 0 && (
        <ul className="grid gap-3">
          {saved.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-center gap-3 border-t border-border pt-3"
            >
              <span className="flex gap-1" aria-hidden>
                {(
                  ['paper', 'ink', 'accent', 'night', 'accentDark'] as const
                ).map((k) => (
                  <span
                    key={k}
                    className="size-5 rounded-full border border-border"
                    style={{ background: t.palette[k] }}
                  />
                ))}
              </span>
              <span className="font-semibold">{t.name}</span>
              {t.live && (
                <span className="text-sm font-semibold text-success">
                  On the site now
                </span>
              )}
              <act.Form method="post" className="ml-auto flex flex-wrap gap-2">
                <input type="hidden" name="id" value={t.id} />
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => onOpen(t)}
                  aria-label={`Open ${t.name} in the editor`}
                >
                  Open in the editor
                </Button>
                {!t.live && (
                  <Button
                    type="submit"
                    name="intent"
                    value="apply"
                    variant="secondary"
                    disabled={act.state !== 'idle'}
                    aria-label={`Use ${t.name} on the site`}
                  >
                    Use on the site
                  </Button>
                )}
                <Button
                  type="submit"
                  name="intent"
                  value="forget"
                  variant="quiet"
                  disabled={act.state !== 'idle'}
                  aria-label={`Delete ${t.name}`}
                >
                  Delete
                </Button>
              </act.Form>
            </li>
          ))}
        </ul>
      )}
      <SaveStatus state={act.state} result={act.data} />
    </Panel>
  );
}

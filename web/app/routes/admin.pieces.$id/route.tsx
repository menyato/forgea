import {
  PIECE_HELD_STAGES,
  PIECE_STAGE_LABELS,
  PIECE_STAGES,
  type PieceDetail,
  type PieceHolderAccount,
  PieceStage,
} from '@forgea/types';
import { FinishPieceDto, UpdatePieceDto } from '@forgea/validation';
import { useState } from 'react';
import { Link, useFetcher, useSearchParams } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { ModelViewer } from '~/features/model-viewer/model-viewer';
import { apiContext } from '~/lib/request.server';
import { studioDay, studioFormat } from '~/lib/studio-time';
import type { Route } from './+types/route';

type Holder = PieceHolderAccount & { team: boolean };

export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [piece, holders] = await Promise.all([
    api.get<PieceDetail>(`/pieces/${encodeURIComponent(params.id)}`),
    // Only for whoever moves pieces (others get 403 and an empty list).
    api.get<Holder[]>('/pieces/holders'),
  ]);
  if (!piece.ok) throw new Response(piece.message, { status: piece.status });
  return { piece: piece.data, holders: holders.ok ? holders.data : [] };
}

/** save | finish */
export async function action({ request, params, context }: Route.ActionArgs) {
  const form = await request.formData();
  const api = context.get(apiContext);
  const base = `/pieces/${encodeURIComponent(params.id)}`;
  if (form.get('intent') === 'finish')
    return save(
      FinishPieceDto,
      {
        failed: form.get('failed') === 'yes',
        progressPercent:
          form.get('failed') === 'yes'
            ? text(form, 'progressPercent')
            : undefined,
        note: text(form, 'note'),
      },
      (dto) => api.post(`${base}/finish`, dto),
    );
  const holderId = text(form, 'holderId');
  return save(
    UpdatePieceDto,
    {
      name: text(form, 'name'),
      quantity: text(form, 'quantity'),
      stage: text(form, 'stage'),
      holder: text(form, 'holder') ?? null,
      holderId: holderId ?? null,
      note: text(form, 'note') ?? null,
      printedOn: text(form, 'printedOn'),
    },
    (dto) => api.patch(base, dto),
  );
}

const WHEN = studioFormat({ dateStyle: 'medium', timeStyle: 'short' });
const accountName = (a: PieceHolderAccount) =>
  a.name ? `${a.name} (${a.email})` : a.email;

export default function PiecePage({ loaderData }: Route.ComponentProps) {
  const { piece: p, holders } = loaderData;
  const mayMove = useCan()('stock.manage');
  const [params] = useSearchParams();
  const asked = params.get('move') as PieceStage | null;
  const printing = p.stage === PieceStage.PRINTING;
  return (
    <>
      <AdminHeader
        title={`${p.quantity > 1 ? `${p.quantity} × ` : ''}${p.name}`}
        intro={`${PIECE_STAGE_LABELS[p.stage]}${
          p.holder || p.holderAccount
            ? ` · ${p.holder ?? accountName(p.holderAccount!)}`
            : ''
        } · printed ${studioDay(p.printedAt)}${p.grams !== null ? ` · ${p.grams} g` : ''}`}
        trail={[{ label: 'Where it is', to: '/admin/pieces' }]}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-6">
          {p.modelKey && (
            <Panel title="The piece">
              <ModelViewer
                modelKey={p.modelKey}
                label={p.name}
                className="max-h-[22rem] rounded-lg border border-border"
              />
              <p className="text-sm text-text-muted">
                {p.productId && (
                  <Link
                    to={`/admin/products/${p.productId}`}
                    className="underline"
                  >
                    Its product
                  </Link>
                )}
                {p.orderNumber && <> · order {p.orderNumber}</>}
                {p.cost !== null && (
                  <>
                    {' '}
                    · <Money amount={p.cost} /> to make
                  </>
                )}
              </p>
            </Panel>
          )}
          {printing && mayMove && (
            <FinishPanel piece={p} open={params.has('finish')} />
          )}
          {!printing && mayMove && (
            <MovePanel piece={p} holders={holders} asked={asked} />
          )}
        </div>
        <Panel title="History">
          <ul className="grid gap-2 text-sm">
            {[...p.moves].reverse().map((m) => (
              <li
                key={`${m.at}-${m.stage}`}
                className="flex flex-wrap justify-between gap-2"
              >
                <span>
                  <strong>{PIECE_STAGE_LABELS[m.stage]}</strong>
                  {(m.holder || m.holderAccount) && (
                    <> · {m.holder ?? accountName(m.holderAccount!)}</>
                  )}
                  {m.note && (
                    <span className="text-text-muted"> · {m.note}</span>
                  )}
                </span>
                <span className="text-xs text-text-muted">
                  {WHEN.format(new Date(m.at))}
                  {m.by ? ` · ${m.by}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

/** Where it is now, who has it (by name, and their account when they have one), its note. */
function MovePanel({
  piece: p,
  holders,
  asked,
}: {
  piece: PieceDetail;
  holders: readonly Holder[];
  asked: PieceStage | null;
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [stage, setStage] = useState<PieceStage>(
    asked && asked !== PieceStage.PRINTING ? asked : p.stage,
  );
  const held = PIECE_HELD_STAGES.includes(stage);
  return (
    <Panel title="Where it is">
      <fetcher.Form method="post" className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="intent" value="save" />
        <SelectField
          label="Where it is"
          name="stage"
          value={stage}
          onChange={(e) => setStage(e.currentTarget.value as PieceStage)}
          error={errors['stage']}
        >
          {PIECE_STAGES.filter((s) => s !== PieceStage.PRINTING).map((s) => (
            <option key={s} value={s}>
              {PIECE_STAGE_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <Field
          label="Printed on"
          name="printedOn"
          type="date"
          defaultValue={studioDay(p.printedAt)}
          error={errors['printedOn']}
        />
        {held && (
          <>
            <Field
              label={
                stage === PieceStage.SOLD
                  ? 'Sold to'
                  : stage === PieceStage.GIVEN
                    ? 'Given to'
                    : 'With'
              }
              name="holder"
              defaultValue={p.holder ?? ''}
              placeholder="e.g. Mira"
              autoComplete="off"
              error={errors['holder']}
            />
            <SelectField
              label="Their account (optional)"
              name="holderId"
              defaultValue={p.holderAccount?.id ?? ''}
              hint="Links the piece to them: it shows on their customer page."
              error={errors['holderId']}
            >
              <option value="">No account</option>
              <optgroup label="The team">
                {holders
                  .filter((h) => h.team)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {accountName(h)}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Customers">
                {holders
                  .filter((h) => !h.team)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {accountName(h)}
                    </option>
                  ))}
              </optgroup>
            </SelectField>
          </>
        )}
        <Field
          label="Name"
          name="name"
          defaultValue={p.name}
          error={errors['name']}
        />
        <Field
          label="How many"
          name="quantity"
          type="number"
          min={1}
          defaultValue={p.quantity}
          error={errors['quantity']}
        />
        <div className="sm:col-span-2">
          <Field
            label="Note"
            name="note"
            defaultValue={p.note ?? ''}
            placeholder="e.g. 1 black and white, 1 white and light brown"
            error={errors['note']}
          />
        </div>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Save
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}

/** A print still on the printer: done (its filament comes off the shelf now) or failed. */
function FinishPanel({
  piece: p,
  open,
}: {
  piece: PieceDetail;
  open: boolean;
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const [failed, setFailed] = useState(false);
  return (
    <Panel title={open ? 'It came off the printer' : 'Still printing'}>
      {p.plan && (
        <p className="text-sm text-text-muted">
          {p.plan.quantity} × {p.name}
          {p.plan.parts ? ` · ${p.plan.parts}` : ''}. Its filament comes off the
          shelf when it is done.
        </p>
      )}
      <fetcher.Form method="post" className="grid gap-3">
        <input type="hidden" name="intent" value="finish" />
        <div
          className="flex flex-wrap gap-4 text-sm"
          role="radiogroup"
          aria-label="How it went"
        >
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="failed"
              value="no"
              checked={!failed}
              onChange={() => setFailed(false)}
            />
            Done
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="failed"
              value="yes"
              checked={failed}
              onChange={() => setFailed(true)}
            />
            Failed
          </label>
        </div>
        {failed && (
          <Field
            label="How far it got (%)"
            name="progressPercent"
            type="number"
            min={1}
            max={100}
            defaultValue={50}
            error={errors['progressPercent']}
          />
        )}
        <Field
          label={failed ? 'What went wrong (optional)' : 'Note (optional)'}
          name="note"
          error={errors['note']}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            {failed ? 'Record the failure' : 'It is done'}
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}

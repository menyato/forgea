import { type QuotationDetail, QuotationStatus } from '@forgea/types';
import { useEffect } from 'react';
import { data, Link, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { ConfirmButton } from '~/components/ui/confirm-button';
import { Field, SelectField } from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { QuotationLookup } from '../admin.quotations.lookup/route';
import type { ActionResult, Line } from './route';

export function QuotationActions({
  quotation: q,
  mayManage,
}: {
  quotation: QuotationDetail;
  mayManage: boolean;
}) {
  const fetcher = useFetcher<ActionResult>();
  const open =
    q.status === QuotationStatus.DRAFT ||
    q.status === QuotationStatus.SENT ||
    q.status === QuotationStatus.DECLINED;
  const declinedWhy =
    q.status === QuotationStatus.DECLINED
      ? q.history.findLast((h) => h.status === QuotationStatus.DECLINED)?.note
      : undefined;
  return (
    <Panel title="Next" className="mt-6">
      {fetcher.data?.order && (
        <p className="font-semibold text-success">
          Sales order {fetcher.data.order.orderNumber} created; it is in Orders.
        </p>
      )}
      {q.status === QuotationStatus.DECLINED && (
        <p role="status" className="rounded-md bg-surface p-3 text-sm">
          <strong>The customer declined it.</strong>{' '}
          {declinedWhy ? `Their reason: "${declinedWhy}". ` : ''}
          Change it and send it again, confirm it if they said yes another way,
          or cancel it.
        </p>
      )}
      {open && !mayManage ? (
        <p className="text-sm text-text-muted">
          {q.status === QuotationStatus.SENT
            ? 'Sent to the customer.'
            : q.status === QuotationStatus.DECLINED
              ? 'Declined by the customer.'
              : 'Draft.'}
        </p>
      ) : open ? (
        <fetcher.Form method="post" className="flex flex-wrap gap-3">
          <Button
            type="submit"
            name="intent"
            value="send"
            variant="secondary"
            disabled={fetcher.state !== 'idle'}
          >
            {q.status === QuotationStatus.SENT
              ? 'Send it again'
              : q.status === QuotationStatus.DECLINED
                ? 'Send the new version'
                : 'Send to the customer'}
          </Button>
          <Button
            type="submit"
            name="intent"
            value="confirm"
            disabled={fetcher.state !== 'idle' || q.expired}
          >
            Confirm: create the order
          </Button>
          {/* Cancelled is final (the customer's link stops working): ask first. */}
          <ConfirmButton
            name="intent"
            value="cancel"
            disabled={fetcher.state !== 'idle'}
            question={`Cancel quotation ${q.number}?`}
            yes="Yes, cancel it"
          >
            Cancel the quotation
          </ConfirmButton>
        </fetcher.Form>
      ) : q.status === QuotationStatus.CONFIRMED && q.orderId ? (
        <div className="grid gap-3">
          <p>
            Confirmed: it is now sales order{' '}
            <Link
              to={`/admin/orders/${q.orderId}`}
              className="font-semibold underline underline-offset-4"
            >
              {q.orderNumber}
            </Link>
            .
          </p>
          {mayManage && (
            <fetcher.Form method="post">
              <ConfirmButton
                name="intent"
                value="cancel"
                disabled={fetcher.state !== 'idle'}
                question={`Cancel quotation ${q.number} and its order ${q.orderNumber}? The customer is told.`}
                yes="Yes, cancel both"
              >
                Cancel the quotation and its order
              </ConfirmButton>
            </fetcher.Form>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-muted">
          Cancelled
          {q.orderId ? (
            <>
              {' '}
              with its order{' '}
              <Link
                to={`/admin/orders/${q.orderId}`}
                className="underline underline-offset-4"
              >
                {q.orderNumber}
              </Link>
            </>
          ) : null}
          .
        </p>
      )}
      <SaveStatus state={fetcher.state} result={fetcher.data} />
      <ol className="grid gap-1 border-l border-border pl-4 text-sm">
        {q.history.map((h) => (
          <li key={h.changedAt + h.status}>
            {h.status.toLowerCase()} ·{' '}
            {new Date(h.changedAt).toLocaleString('en-GB')}
            {h.note ? ` · ${h.note}` : ''}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/**
 * A line's printed size: a product's own sizes to choose from (each with its price), or, for a
 * free-text line or a product without sizes, the measurements typed in.
 */
export function LineSize({
  index: i,
  line: l,
  slug,
  onChange,
}: {
  index: number;
  line: Line;
  slug: string | undefined;
  onChange: (change: Partial<Line>) => void;
}) {
  const sizes = useFetcher<QuotationLookup | null>();
  useEffect(() => {
    if (slug)
      void sizes.load(
        `/admin/quotations/lookup?product=${encodeURIComponent(slug)}`,
      );
  }, [slug]);
  const choices =
    slug && sizes.data && 'sizes' in sizes.data ? sizes.data.sizes : [];
  if (choices.length > 0) {
    const chosen =
      choices.find((c) => c.id === l.sizeId) ??
      choices.find(
        (c) => c.x === l.sizeX && c.y === l.sizeY && c.z === l.sizeZ,
      );
    return (
      <div className="sm:col-span-full sm:max-w-md">
        <SelectField
          label="Size"
          name={`line-${i}-size`}
          value={chosen?.id ?? ''}
          onChange={(e) => {
            const c = choices.find((x) => x.id === e.currentTarget.value);
            onChange(
              c
                ? {
                    sizeId: c.id,
                    sizeX: c.x,
                    sizeY: c.y,
                    sizeZ: c.z,
                    ...(c.unitPrice ? { unitPrice: c.unitPrice } : {}),
                  }
                : { sizeId: '', sizeX: '', sizeY: '', sizeZ: '' },
            );
          }}
        >
          <option value="">Choose a size…</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.unitPrice ? ` · $${c.unitPrice}` : ''}
            </option>
          ))}
        </SelectField>
      </div>
    );
  }
  return (
    <fieldset className="grid grid-cols-3 gap-2 sm:col-span-full sm:max-w-md">
      <legend className="mb-1 text-sm font-medium">
        Printed size, cm (optional: all three)
      </legend>
      {(
        [
          ['sizeX', 'Width'],
          ['sizeY', 'Depth'],
          ['sizeZ', 'Height'],
        ] as const
      ).map(([key, label]) => (
        <Field
          key={key}
          label={label}
          name={`line-${i}-${key}`}
          inputMode="decimal"
          placeholder="cm"
          autoComplete="off"
          value={l[key]}
          onChange={(e) => onChange({ [key]: e.currentTarget.value })}
        />
      ))}
    </fieldset>
  );
}

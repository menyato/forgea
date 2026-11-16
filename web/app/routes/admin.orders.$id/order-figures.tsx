import type {
  OrderProduction,
  PrintJobListItem,
  StaffOrder,
} from '@forgea/types';
import { Money } from '~/components/money';
import { Panel } from '~/features/admin/admin-ui';
import { type SmartButton, SmartButtons } from '~/features/admin/smart-buttons';

/**
 * The order in figures, joined to where each comes from: the filament it takes (and what
 * stock gave it), its print time and jobs, its invoices, and, for those who see the books, what
 * it costs to make and earns. Estimates use the products' sliced files and today's pricing.
 */
export function OrderFigures({
  order,
  production,
  jobs,
}: {
  order: StaffOrder;
  production: OrderProduction;
  jobs: readonly PrintJobListItem[] | null;
}) {
  const q = encodeURIComponent(order.orderNumber);
  const colours = new Set(
    production.lines.flatMap((l) => l.colours.map((c) => c.colour)),
  ).size;
  const taken = production.taken.reduce((n, t) => n + t.grams, 0);
  // Lines measured by their print runs, rather than estimated from a product.
  const measured = production.lines.filter((l) => l.measured).length;
  const basis =
    measured === 0
      ? 'estimated'
      : measured === production.lines.length
        ? 'from its print runs'
        : 'estimated and measured';
  const open = (order.invoices ?? []).filter(
    (i) => i.state === 'POSTED' && Number(i.residual) > 0,
  );
  const buttons: SmartButton[] = [
    {
      label: 'Filament',
      value: `${production.grams} g`,
      hint:
        taken > 0
          ? `${taken} g taken from stock`
          : `${colours} colour${colours === 1 ? '' : 's'} · not taken yet`,
      to: `/admin/stock/movements?q=${q}`,
    },
    {
      label: 'Print time',
      value: `${production.printHours} h`,
      hint:
        jobs === null
          ? undefined
          : `${jobs.length} print job${jobs.length === 1 ? '' : 's'}`,
      to: jobs === null ? undefined : `/admin/production?q=${q}`,
    },
    ...(production.money
      ? [
          {
            label: 'Cost to make',
            value: <Money amount={production.money.cost} />,
            hint: basis,
            to: '#order-filament',
          },
          {
            label: 'Profit',
            value: <Money amount={production.money.profit} />,
            hint:
              production.money.marginPercent === null
                ? basis
                : `${production.money.marginPercent}% of the sale, ${basis}`,
            to: '/admin/insights',
          },
        ]
      : []),
    ...(order.invoices
      ? [
          {
            label: 'Invoices',
            value: String(order.invoices.length),
            hint:
              order.invoices.length === 0
                ? 'none yet'
                : open.length > 0
                  ? `${open.length} not paid in full`
                  : 'nothing owed',
            to: '#order-invoices',
          },
        ]
      : []),
  ];

  return (
    <>
      <SmartButtons label="This order in figures" buttons={buttons} />
      <div id="order-filament" className="mb-6">
        <Panel title="What it takes to make">
          <table aria-label="Filament by line" className="w-full text-sm">
            <thead className="text-left text-text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Line</th>
                <th className="py-1 pr-3 font-medium">Filament</th>
                <th className="py-1 pr-3 text-right font-medium">Time</th>
                {production.money && (
                  <th className="py-1 text-right font-medium">Cost</th>
                )}
              </tr>
            </thead>
            <tbody>
              {production.lines.map((l) => (
                <tr key={l.itemId} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3">
                    {l.quantity} × {l.name}
                    {l.measured && (
                      <span className="block text-xs text-text-muted">
                        as printed
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    {l.grams === null
                      ? 'Not estimated or printed yet'
                      : l.colours
                          .map(
                            (c) => `${c.grams} g ${c.colour || 'any colour'}`,
                          )
                          .join(', ')}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {l.printHours === null ? '—' : `${l.printHours} h`}
                  </td>
                  {production.money && (
                    <td className="py-1.5 text-right tabular-nums">
                      {l.cost === null ? '—' : <Money amount={l.cost} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {production.taken.length === 0 && production.shelf.length > 0 && (
            <ul aria-label="On the shelf" className="mt-3 grid gap-1 text-sm">
              {production.shelf.map((s) => (
                <li
                  key={`${s.material} ${s.colour}`}
                  className={s.short ? 'text-danger' : 'text-text-muted'}
                >
                  {s.short ? '⚠ ' : '✓ '}
                  {s.material} {s.colour}: needs {s.needed} g,{' '}
                  {s.onShelf === null
                    ? 'no reel of it on the shelf: buy it or link the colour to a reel you have'
                    : s.short
                      ? `only ${s.onShelf} g left: not enough`
                      : `${s.onShelf} g on the shelf`}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm text-text-muted">
            {production.taken.length > 0
              ? `Taken from stock: ${production.taken
                  .map((t) => `${t.grams} g ${t.material} ${t.colour}`.trim())
                  .join(', ')}.`
              : 'Stock gives its filament when the order goes into production.'}{' '}
            Purge, prime tower and supports are counted when the product&apos;s
            numbers come from its sliced files.
          </p>
        </Panel>
      </div>
    </>
  );
}

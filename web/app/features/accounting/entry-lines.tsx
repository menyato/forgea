import type { JournalEntryView } from '@forgea/types';
import { Money } from '~/components/money';

/** A journal entry's lines, debits beside credits, with their totals (an entry and an invoice). */
export function EntryLines({ entry }: { entry: JournalEntryView }) {
  // In cents: 10.10 + 20.20 must read 30.30.
  const sum = (pick: (l: JournalEntryView['lines'][number]) => string) =>
    (
      entry.lines.reduce((s, l) => s + Math.round(Number(pick(l)) * 100), 0) /
      100
    ).toFixed(2);
  return (
    <div className="overflow-x-auto">
      <table aria-label="Journal lines" className="w-full text-sm">
        <thead className="text-left text-text-muted">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">
              Account
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Label
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Debit
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Credit
            </th>
          </tr>
        </thead>
        <tbody>
          {entry.lines.map((l, i) => (
            <tr key={i} className="border-t border-border">
              <td className="py-2 pr-4">
                <span className="mr-2 font-mono text-text-muted">
                  {l.account.code}
                </span>
                {l.account.name}
              </td>
              <td className="py-2 pr-4">{l.label}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {Number(l.debit) > 0 && <Money amount={l.debit} />}
              </td>
              <td className="py-2 text-right tabular-nums">
                {Number(l.credit) > 0 && <Money amount={l.credit} />}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td className="py-2 pr-4" colSpan={2}>
              Total
            </td>
            <td className="py-2 pr-4 text-right">
              <Money amount={sum((l) => l.debit)} />
            </td>
            <td className="py-2 text-right">
              <Money amount={sum((l) => l.credit)} />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

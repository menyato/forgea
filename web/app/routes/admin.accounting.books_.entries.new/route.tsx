import type { AccountView, JournalEntryView } from '@forgea/types';
import { ManualEntryDto } from '@forgea/validation';
import { useState } from 'react';
import { redirect, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';
import { studioToday } from '~/lib/studio-time';

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context
    .get(apiContext)
    .get<AccountView[]>('/accounting/accounts');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { accounts: r.data.filter((a) => a.active) };
}

/** Posts the entry and opens it. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    ManualEntryDto,
    {
      date: text(form, 'date'),
      label: text(form, 'label'),
      lines: jsonField(form, 'lines') ?? [],
    },
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<JournalEntryView>('/accounting/entries', dto);
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/accounting/books/entries/${createdId}`);
  return result;
}

interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

export default function NewEntry({ loaderData }: Route.ComponentProps) {
  const { accounts } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const mayManage = useCan()('books.manage');
  const blank = (): Line => ({
    accountId: accounts[0]?.id ?? '',
    debit: '',
    credit: '',
  });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const set = (i: number, change: Partial<Line>) =>
    setLines((all) => all.map((l, j) => (j === i ? { ...l, ...change } : l)));
  // In cents: 10.10 + 20.20 must equal 30.30 (as decimals it is 30.299999…).
  const cents = (v: string) => Math.round((Number(v) || 0) * 100);
  const debits = lines.reduce((s, l) => s + cents(l.debit), 0) / 100;
  const credits = lines.reduce((s, l) => s + cents(l.credit), 0) / 100;
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Books', to: '/admin/accounting/books' }]}
        title="New entry"
        intro="Opening balances, an expense paid in cash, money the owner puts in. Debits must equal credits; once posted, the entry never changes."
      />
      <Panel>
        <ViewOnly editable={mayManage}>
          <fetcher.Form method="post" className="grid gap-3">
            <input
              type="hidden"
              name="lines"
              value={JSON.stringify(
                lines.map((l) => ({
                  accountId: l.accountId,
                  debit: l.debit || '0',
                  credit: l.credit || '0',
                })),
              )}
            />
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Field
                label="Date"
                name="date"
                type="date"
                required
                defaultValue={studioToday()}
                error={errors['date']}
              />
              <Field
                label="What it is"
                name="label"
                required
                error={errors['label']}
              />
            </div>
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] gap-2"
              >
                <SelectField
                  label="Account"
                  name={`entry-${i}-account`}
                  value={l.accountId}
                  onChange={(e) => set(i, { accountId: e.currentTarget.value })}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </SelectField>
                <Field
                  label="Debit"
                  name={`entry-${i}-debit`}
                  inputMode="decimal"
                  value={l.debit}
                  onChange={(e) =>
                    set(i, { debit: e.currentTarget.value, credit: '' })
                  }
                />
                <Field
                  label="Credit"
                  name={`entry-${i}-credit`}
                  inputMode="decimal"
                  value={l.credit}
                  onChange={(e) =>
                    set(i, { credit: e.currentTarget.value, debit: '' })
                  }
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                onClick={() => setLines((all) => [...all, blank()])}
              >
                Add a line
              </Button>
              <span
                className={`text-sm ${debits === credits && debits > 0 ? 'text-success' : 'text-text-muted'}`}
              >
                Debits {debits.toFixed(2)} · Credits {credits.toFixed(2)}
              </span>
              <Button
                type="submit"
                disabled={
                  fetcher.state !== 'idle' || debits !== credits || debits === 0
                }
              >
                Post
              </Button>
              <SaveStatus state={fetcher.state} result={fetcher.data} />
            </div>
          </fetcher.Form>
        </ViewOnly>
      </Panel>
    </>
  );
}

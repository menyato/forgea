import {
  AccountType,
  type AccountingSettingsView,
  type AccountView,
  type JournalEntryView,
} from '@forgea/types';
import {
  ManualEntryDto,
  SaveAccountDto,
  UpdateAccountingSettingsDto,
} from '@forgea/validation';
import { useState } from 'react';
import { useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { jsonField } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const [accounts, settings, entries] = await Promise.all([
    api.get<AccountView[]>('/accounting/accounts'),
    api.get<AccountingSettingsView>('/accounting/settings'),
    api.get<JournalEntryView[]>('/accounting/entries'),
  ]);
  for (const r of [accounts, settings, entries])
    if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    accounts: accounts.ok ? accounts.data : [],
    settings: settings.ok ? settings.data : null,
    entries: entries.ok ? entries.data : [],
  };
}

/** account | settings | entry */
export async function action({ request, context }: Route.ActionArgs) {
  const api = context.get(apiContext);
  const form = await request.formData();
  switch (form.get('intent')) {
    case 'settings':
      return save(
        UpdateAccountingSettingsDto,
        {
          salesTaxId: text(form, 'salesTaxId') ?? null,
          lockDate: text(form, 'lockDate') ?? null,
        },
        (dto) => api.put('/accounting/settings', dto),
      );
    case 'entry':
      return save(
        ManualEntryDto,
        {
          date: text(form, 'date'),
          label: text(form, 'label'),
          lines: jsonField(form, 'lines') ?? [],
        },
        (dto) => api.post('/accounting/entries', dto),
      );
    default: {
      const id = text(form, 'id');
      return save(
        SaveAccountDto,
        {
          code: text(form, 'code'),
          name: text(form, 'name'),
          type: text(form, 'type'),
          active: checked(form, 'active'),
        },
        (dto) =>
          id
            ? api.put(`/accounting/accounts/${encodeURIComponent(id)}`, dto)
            : api.post('/accounting/accounts', dto),
      );
    }
  }
}

const TYPE_LABELS: Record<AccountType, string> = {
  RECEIVABLE: 'Customers owe',
  PAYABLE: 'Owed to suppliers',
  CASH: 'Cash',
  BANK: 'Bank / transfers',
  CURRENT_ASSET: 'Current asset',
  FIXED_ASSET: 'Fixed asset',
  CURRENT_LIABILITY: 'Liability',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expense',
};

export default function Books({ loaderData }: Route.ComponentProps) {
  const { accounts, settings, entries } = loaderData;
  return (
    <>
      <AdminHeader
        title="Books"
        intro="The chart of accounts, the sales tax, the lock date, and every posted entry. Posted entries never change: correct with a new entry or a credit note."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        {settings && <SettingsForm settings={settings} />}
        <ManualEntry accounts={accounts.filter((a) => a.active)} />
        <Panel title="Accounts">
          <div className="grid gap-1 text-sm">
            {accounts.map((a) => (
              <div key={a.id} className="flex justify-between gap-4">
                <span
                  className={a.active ? '' : 'text-text-muted line-through'}
                >
                  <span className="mr-2 font-mono text-text-muted">
                    {a.code}
                  </span>
                  {a.name}
                  <span className="ml-2 text-xs text-text-muted">
                    {TYPE_LABELS[a.type as AccountType]}
                  </span>
                </span>
                <Money amount={a.balance} />
              </div>
            ))}
          </div>
          <AccountForm />
        </Panel>
        <Panel title="Latest entries">
          <ul className="grid gap-3 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="border-b border-border pb-2">
                <p>
                  <span className="font-mono font-semibold">{e.number}</span> ·{' '}
                  {e.date} · {e.label}
                </p>
                {e.lines.map((l, i) => (
                  <p
                    key={i}
                    className="flex justify-between text-xs text-text-muted"
                  >
                    <span>
                      {l.account.code} {l.account.name}
                    </span>
                    <span className="tabular-nums">
                      {Number(l.debit) > 0 ? `Dr ${l.debit}` : `Cr ${l.credit}`}
                    </span>
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

function SettingsForm({ settings }: { settings: AccountingSettingsView }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <Panel title="Tax and lock date">
      <fetcher.Form method="post" className="grid gap-4">
        <input type="hidden" name="intent" value="settings" />
        <SelectField
          label="Sales tax included in shop prices"
          name="salesTaxId"
          defaultValue={settings.salesTax?.id ?? ''}
          hint="Decide with your accountant. Invoices then show the tax separately; shop prices don't change."
        >
          <option value="">No tax</option>
          {settings.taxes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <Field
          label="Books locked up to"
          name="lockDate"
          type="date"
          defaultValue={settings.lockDate ?? ''}
          hint="Nothing can be posted on or before this date. It only moves forward."
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Save
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}

function AccountForm() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form
      method="post"
      key={fetcher.data?.ok ? 'reset' : 'form'}
      className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[6rem_minmax(0,1fr)_12rem_auto] sm:items-end"
    >
      <input type="hidden" name="intent" value="account" />
      <Field label="Code" name="code" required error={errors['code']} />
      <Field label="New account" name="name" required error={errors['name']} />
      <SelectField label="Type" name="type" defaultValue={AccountType.EXPENSE}>
        {Object.entries(TYPE_LABELS).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </SelectField>
      <input type="hidden" name="active" value="on" />
      <Button
        type="submit"
        variant="secondary"
        disabled={fetcher.state !== 'idle'}
      >
        Add
      </Button>
      <div className="sm:col-span-4">
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}

interface Line {
  accountId: string;
  debit: string;
  credit: string;
}

function ManualEntry({ accounts }: { accounts: AccountView[] }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
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
    <Panel title="Manual entry">
      <p className="text-sm text-text-muted">
        Opening balances, an expense paid in cash, money the owner puts in.
        Debits must equal credits.
      </p>
      <fetcher.Form
        method="post"
        key={fetcher.data?.ok ? 'reset' : 'form'}
        className="grid gap-3"
      >
        <input type="hidden" name="intent" value="entry" />
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
            defaultValue={new Date().toISOString().slice(0, 10)}
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
    </Panel>
  );
}

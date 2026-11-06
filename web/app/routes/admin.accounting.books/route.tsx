import {
  AccountType,
  type AccountingSettingsView,
  type AccountView,
  type JournalEntryView,
  type Page,
} from '@forgea/types';
import {
  SaveAccountDto,
  UpdateAccountingSettingsDto,
} from '@forgea/validation';
import { Link, useFetcher } from 'react-router';
import { Money } from '~/components/money';
import { Button, buttonClass } from '~/components/ui/button';
import { Field, SelectField } from '~/components/ui/field';
import { useCan } from '~/features/admin/access';
import {
  AdminHeader,
  Panel,
  SaveStatus,
  ViewOnly,
} from '~/features/admin/admin-ui';
import { listState, pageQuery } from '~/features/admin/list-state';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import {
  ControlPanel,
  type ListColumn,
  ListView,
} from '~/features/admin/views';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** The kinds of entry; the API returns one kind (or all) at a time. */
const TYPES = [
  { key: 'INVOICE', label: 'Invoices' },
  { key: 'CREDIT_NOTE', label: 'Credit notes' },
  { key: 'PAYMENT', label: 'Payments' },
  { key: 'ENTRY', label: 'Manual entries' },
] as const;
const TYPE_NAMES: Record<JournalEntryView['type'], string> = {
  INVOICE: 'Invoice',
  CREDIT_NOTE: 'Credit note',
  PAYMENT: 'Payment',
  ENTRY: 'Manual entry',
};

const DEFAULTS = { sorts: ['date', 'number'] };

const GROUPS = [
  { key: 'type', label: 'Kind' },
  { key: 'journal', label: 'Journal' },
  { key: 'month', label: 'Month' },
];

/** What an entry moves: its debits (which equal its credits). */
const amountOf = (e: JournalEntryView) =>
  e.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0) / 100;

const month = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export async function loader({ url, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const state = listState(url.searchParams, DEFAULTS);
  const type = TYPES.find((t) => state.filters.includes(t.key));
  const query = pageQuery(state, 50);
  if (type) query.set('type', type.key);
  const [accounts, settings, entries] = await Promise.all([
    api.get<AccountView[]>('/accounting/accounts'),
    api.get<AccountingSettingsView>('/accounting/settings'),
    api.get<Page<JournalEntryView>>(`/accounting/entries?${query}`),
  ]);
  if (!entries.ok)
    throw new Response(entries.message, { status: entries.status });
  for (const r of [accounts, settings])
    if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    state,
    page: entries.data,
    accounts: accounts.ok ? accounts.data : [],
    settings: settings.ok ? settings.data : null,
  };
}

/** account | settings */
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

const COLUMNS: ListColumn<JournalEntryView>[] = [
  {
    key: 'number',
    label: 'Number',
    sort: 'number',
    cell: (e) => <span className="font-mono">{e.number}</span>,
  },
  { key: 'date', label: 'Date', sort: 'date', cell: (e) => e.date },
  {
    key: 'kind',
    label: 'Kind',
    cell: (e) => <span className="text-text-muted">{TYPE_NAMES[e.type]}</span>,
  },
  { key: 'label', label: 'What it is', cell: (e) => e.label },
  {
    key: 'order',
    label: 'Order',
    cell: (e) => <span className="font-mono">{e.orderNumber ?? ''}</span>,
  },
  {
    key: 'amount',
    label: 'Amount',
    align: 'right',
    cell: (e) => <Money amount={amountOf(e).toFixed(2)} />,
  },
];

export default function Books({ loaderData }: Route.ComponentProps) {
  const { state, page, accounts, settings } = loaderData;
  const mayManage = useCan()('books.manage');
  return (
    <>
      <AdminHeader
        trail={[{ label: 'Invoices', to: '/admin/accounting' }]}
        title="Books"
        intro="Every posted entry, the chart of accounts, the sales tax and the lock date. Posted entries never change: correct with a new entry or a credit note."
        action={
          mayManage ? (
            <Link
              to="/admin/accounting/books/entries/new"
              className={buttonClass()}
            >
              New entry
            </Link>
          ) : undefined
        }
      />
      <ControlPanel
        state={state}
        search="Number, label, order or customer"
        filters={TYPES.map((t) => ({
          key: t.key,
          label: t.label,
          only: 'type',
        }))}
        groups={GROUPS}
        page={{
          shown: page.items.length,
          nextCursor: page.nextCursor,
        }}
      />
      <ListView
        label="Journal entries"
        rows={page.items}
        columns={COLUMNS}
        href={(e) => `/admin/accounting/books/entries/${e.id}`}
        state={state}
        empty="No entries here."
        group={(k) =>
          k === 'type'
            ? {
                of: (e) => TYPE_NAMES[e.type],
                order: Object.values(TYPE_NAMES),
              }
            : k === 'journal'
              ? { of: (e) => e.journal.name }
              : k === 'month'
                ? { of: (e) => month(e.date) }
                : undefined
        }
      />
      <div className="mt-8">
        <ViewOnly editable={mayManage}>
          <div className="grid gap-6 xl:grid-cols-2">
            {settings && <SettingsForm settings={settings} />}
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
          </div>
        </ViewOnly>
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

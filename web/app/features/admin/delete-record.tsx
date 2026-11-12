import type { Permission } from '@forgea/types';
import { useId } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { useCan } from './access';
import type { SaveResult } from './staff.server';

/** What can be deleted from its page: the API route, the permission, the list to go back to. */
export const DELETABLE = {
  product: {
    api: '/products',
    list: '/admin/products',
    permission: 'catalog.manage',
  },
  category: {
    api: '/categories',
    list: '/admin/categories',
    permission: 'catalog.manage',
  },
  material: {
    api: '/materials',
    list: '/admin/materials',
    permission: 'materials.manage',
  },
  optionGroup: {
    api: '/option-groups',
    list: '/admin/options',
    permission: 'catalog.manage',
  },
  optionValue: {
    api: '/option-groups/values',
    list: '/admin/options',
    permission: 'catalog.manage',
  },
  stockItem: {
    api: '/stock/items',
    list: '/admin/stock',
    permission: 'stock.manage',
  },
  printer: {
    api: '/printers',
    list: '/admin/printers',
    permission: 'production.manage',
  },
  lead: { api: '/leads', list: '/admin/leads', permission: 'leads.manage' },
  lostReason: {
    api: '/lost-reasons',
    list: '/admin/lost-reasons',
    permission: 'pipeline.manage',
  },
  leadStage: {
    api: '/lead-stages',
    list: '/admin/lead-stages',
    permission: 'pipeline.manage',
  },
} as const satisfies Record<
  string,
  { api: string; list: string; permission: Permission }
>;
export type DeletableKind = keyof typeof DELETABLE;

/**
 * Deleting this record, after a tick to confirm. Refused while history still uses it (orders,
 * stock, print runs…): the reason shows here, with what to do instead. Only for someone who
 * manages that kind of record.
 */
export function DeleteRecord({
  kind,
  id,
  what,
  back,
}: {
  kind: DeletableKind;
  id: string;
  /** "this product", "Red": said on the button and the confirmation. */
  what: string;
  /** Where to go once deleted (default: the record's list). */
  back?: string;
}) {
  const fetcher = useFetcher<SaveResult>();
  const can = useCan();
  const confirmId = useId();
  if (!can(DELETABLE[kind].permission)) return null;
  return (
    <fetcher.Form
      method="post"
      action="/admin/delete"
      className="flex flex-wrap items-center gap-3 text-sm"
    >
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      {back && <input type="hidden" name="back" value={back} />}
      <label htmlFor={confirmId} className="flex items-center gap-2">
        <input
          id={confirmId}
          type="checkbox"
          name="confirm"
          autoComplete="off"
          required
        />
        Yes, delete {what}
      </label>
      <Button
        type="submit"
        variant="secondary"
        disabled={fetcher.state !== 'idle'}
      >
        Delete
      </Button>
      {fetcher.data?.error && (
        <p role="alert" className="w-full text-danger">
          {fetcher.data.error}
        </p>
      )}
    </fetcher.Form>
  );
}

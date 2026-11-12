import { data, redirect } from 'react-router';
import type { SaveResult } from '~/features/admin/staff.server';
import { DELETABLE, type DeletableKind } from '~/features/admin/delete-record';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/**
 * Deletes one dashboard record (the Delete button on its page): the API checks the permission
 * and refuses a record history still uses, saying what uses it; deleted, the page goes back to
 * the record's list.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const kind = form.get('kind');
  const id = form.get('id');
  if (
    typeof kind !== 'string' ||
    !(kind in DELETABLE) ||
    typeof id !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(id)
  )
    return data<SaveResult>({ error: 'Nothing to delete' }, { status: 400 });
  if (form.get('confirm') !== 'on')
    return data<SaveResult>(
      { error: 'Tick the box to confirm' },
      { status: 400 },
    );
  const rule = DELETABLE[kind as DeletableKind];
  const r = await context
    .get(apiContext)
    .delete(`${rule.api}/${encodeURIComponent(id)}`);
  if (!r.ok)
    return data<SaveResult>({ error: r.message }, { status: r.status });
  const back = form.get('back');
  throw redirect(
    typeof back === 'string' && back.startsWith('/admin/') ? back : rule.list,
  );
}

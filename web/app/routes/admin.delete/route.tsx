import type { DeletionImpact } from '@forgea/types';
import { data, redirect } from 'react-router';
import type { SaveResult } from '~/features/admin/staff.server';
import { DELETABLE, type DeletableKind } from '~/features/admin/delete-record';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

const UUID = /^[0-9a-f-]{36}$/;
/** At most this many at once: a list's page. */
const MOST = 100;

function kindOf(value: unknown): DeletableKind | null {
  return typeof value === 'string' && value in DELETABLE
    ? (value as DeletableKind)
    : null;
}

function idsOf(values: readonly unknown[]): string[] | null {
  const ids = [
    ...new Set(values.filter((v): v is string => typeof v === 'string')),
  ];
  return ids.length > 0 &&
    ids.length <= MOST &&
    ids.every((id) => UUID.test(id))
    ? ids
    : null;
}

export interface DeletionPreview {
  impacts: DeletionImpact[];
  /** Records the API wouldn't describe (gone already, not allowed). */
  errors: string[];
}

/**
 * What deleting the chosen records would do, asked before anything is deleted:
 * `?kind=product&id=…&id=…`. The API says for each what keeps it, what goes with it and what
 * lets go of it; the dialog shows it and the person decides.
 */
export async function loader({ url, context }: Route.LoaderArgs) {
  const kind = kindOf(url.searchParams.get('kind'));
  const ids = idsOf(url.searchParams.getAll('id'));
  if (!kind || !ids)
    return data<DeletionPreview>(
      { impacts: [], errors: ['Nothing to delete'] },
      { status: 400 },
    );
  const api = context.get(apiContext);
  const rule = DELETABLE[kind];
  const answers = await Promise.all(
    ids.map((id) =>
      api.get<DeletionImpact>(`${rule.api}/${encodeURIComponent(id)}/deletion`),
    ),
  );
  return data<DeletionPreview>({
    impacts: answers.flatMap((r) => (r.ok ? [r.data] : [])),
    errors: answers.flatMap((r) => (r.ok ? [] : [r.message])),
  });
}

/**
 * Deletes the chosen records (one from its page, several from a list), once the person has
 * seen what it does: the API checks the permission and refuses each record history still uses.
 * From a record's page it goes back to the list; from a list it stays there, saying what
 * couldn't go.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const kind = kindOf(form.get('kind'));
  const ids = idsOf(form.getAll('id'));
  if (!kind || !ids)
    return data<SaveResult>({ error: 'Nothing to delete' }, { status: 400 });
  if (form.get('confirm') !== 'yes')
    return data<SaveResult>(
      { error: 'Confirm the deletion first' },
      { status: 400 },
    );
  const rule = DELETABLE[kind];
  const api = context.get(apiContext);
  const refused: string[] = [];
  for (const id of ids) {
    const r = await api.delete(`${rule.api}/${encodeURIComponent(id)}`);
    if (!r.ok) refused.push(r.message);
  }
  if (refused.length > 0)
    return data<SaveResult>(
      {
        error:
          ids.length === 1
            ? refused[0]!
            : `${ids.length - refused.length} of ${ids.length} deleted. ${refused.join(' ')}`,
      },
      { status: 409 },
    );
  const back = form.get('back');
  if (typeof back === 'string' && back.startsWith('/admin/'))
    throw redirect(back);
  return data<SaveResult>({ ok: true });
}

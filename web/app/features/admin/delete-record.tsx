import type { DeletionImpact, DeletionUse, Permission } from '@forgea/types';
import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import type { DeletionPreview } from '~/routes/admin.delete/route';
import { useCan } from './access';
import type { SaveResult } from './staff.server';

/** What can be deleted: the API route, the permission, the list to go back to. */
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

/** Whether this person may delete records of that kind. */
export function useCanDelete(kind: DeletableKind | undefined): boolean {
  const can = useCan();
  return kind !== undefined && can(DELETABLE[kind].permission);
}

/**
 * The Delete button on a record's page: it first shows what deleting does (what goes with it,
 * what lets go of it, or what keeps it), and deletes only once confirmed. Only for someone who
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
  /** "this product": said on the button. */
  what: string;
  /** Where to go once deleted (default: the record's list). */
  back?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!useCanDelete(kind)) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Delete {what}…
      </Button>
      {open && (
        <DeleteDialog
          kind={kind}
          ids={[id]}
          back={back ?? DELETABLE[kind].list}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const said = (list: readonly DeletionUse[]) =>
  list.map((u) => `${u.count} ${u.what}`).join(', ');

/**
 * Asks before deleting: for each chosen record, what deleting it does. Records history keeps
 * are listed with what keeps them and what to do instead; the rest are deleted on "Delete",
 * or nothing is on "Keep them".
 */
export function DeleteDialog({
  kind,
  ids,
  back,
  onClose,
  onDeleted,
}: {
  kind: DeletableKind;
  ids: readonly string[];
  /** Where to go once deleted; without it the page stays (a list reloads). */
  back?: string | undefined;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useFetcher<DeletionPreview>();
  const remove = useFetcher<SaveResult>();
  const query = new URLSearchParams([
    ['kind', kind],
    ...ids.map((id) => ['id', id]),
  ]).toString();

  useEffect(() => {
    dialog.current?.showModal();
    void preview.load(`/admin/delete?${query}`);
    // Loads once per set of records (the fetcher itself changes on every render).
  }, [query]);
  useEffect(() => {
    if (remove.state === 'idle' && remove.data?.ok) {
      onDeleted?.();
      onClose();
    }
  }, [remove.state, remove.data, onClose, onDeleted]);

  const impacts = preview.data?.impacts ?? [];
  const going = impacts.filter((i) => i.deletable);
  const kept = impacts.filter((i) => !i.deletable);
  const loading = preview.state !== 'idle' || !preview.data;
  const submit = () => {
    const form = new FormData();
    form.set('kind', kind);
    form.set('confirm', 'yes');
    if (back) form.set('back', back);
    for (const i of going) form.append('id', i.id);
    void remove.submit(form, { method: 'post', action: '/admin/delete' });
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-labelledby="delete-dialog-title"
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-border bg-surface p-0 text-text shadow-xl backdrop:bg-black/50"
    >
      <div className="grid max-h-[80vh] gap-4 overflow-y-auto p-5">
        <h2 id="delete-dialog-title" className="font-display text-lg font-bold">
          {ids.length === 1
            ? 'Delete this record?'
            : `Delete ${ids.length} records?`}
        </h2>
        {loading ? (
          <p className="text-sm text-text-muted">Checking what uses it…</p>
        ) : (
          <>
            {going.length > 0 && (
              <section aria-label="Will be deleted" className="grid gap-2">
                <h3 className="text-sm font-semibold">
                  Will be deleted ({going.length})
                </h3>
                <ul className="grid gap-2 text-sm">
                  {going.map((i) => (
                    <ImpactRow key={i.id} impact={i} />
                  ))}
                </ul>
              </section>
            )}
            {kept.length > 0 && (
              <section aria-label="Can't be deleted" className="grid gap-2">
                <h3 className="text-sm font-semibold text-danger">
                  Can’t be deleted ({kept.length})
                </h3>
                <ul className="grid gap-2 text-sm">
                  {kept.map((i) => (
                    <ImpactRow key={i.id} impact={i} />
                  ))}
                </ul>
              </section>
            )}
            {preview.data?.errors.map((e) => (
              <p key={e} role="alert" className="text-sm text-danger">
                {e}
              </p>
            ))}
          </>
        )}
        {remove.data?.error && (
          <p role="alert" className="text-sm text-danger">
            {remove.data.error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => dialog.current?.close()}>
            {going.length > 0 ? 'Keep them' : 'Close'}
          </Button>
          {going.length > 0 && (
            <Button
              variant="secondary"
              onClick={submit}
              disabled={remove.state !== 'idle'}
              className="!border-danger font-semibold !text-danger"
            >
              Delete {going.length === 1 ? 'it' : `these ${going.length}`}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}

function ImpactRow({ impact }: { impact: DeletionImpact }) {
  return (
    <li className="rounded-md border border-border p-3">
      <p className="font-semibold">{impact.name}</p>
      {impact.deletable ? (
        <>
          <p className="text-text-muted">
            {impact.removes.length > 0
              ? `Also deletes: ${said(impact.removes)}.`
              : 'Nothing else uses it.'}
          </p>
          {impact.unlinks.length > 0 && (
            <p className="text-text-muted">
              No longer linked: {said(impact.unlinks)}.
            </p>
          )}
        </>
      ) : (
        <p className="text-text-muted">
          {impact.blockedBy.length > 0 && `Used by ${said(impact.blockedBy)}. `}
          {impact.instead}
        </p>
      )}
    </li>
  );
}

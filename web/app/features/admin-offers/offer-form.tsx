import type { FreeOfferView, QuotableProduct } from '@forgea/types';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, SelectField } from '~/components/ui/field';
import { Panel, SaveStatus } from '~/features/admin/admin-ui';
import type { SaveResult } from '~/features/admin/staff.server';
import { studioInput } from '~/lib/studio-time';

/**
 * A free offer's form (new or existing): which piece, what the banner says, when it runs (the
 * studio's time) and how many to give. Customers claim it on the piece's page, one each.
 */
export function OfferForm({
  offer,
  products,
}: {
  offer?: FreeOfferView;
  products: readonly QuotableProduct[];
}) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <fetcher.Form method="post" className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="The offer">
          <SelectField
            label="Piece given"
            name="productId"
            required
            defaultValue={offer?.productId ?? ''}
            error={errors['productId']}
            hint="Customers design it as usual on its page, then claim it free"
          >
            <option value="" disabled>
              Choose a product…
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.active ? '' : ' (not in the shop)'}
              </option>
            ))}
          </SelectField>
          <Field
            label="What the banner says"
            name="title"
            required
            maxLength={80}
            defaultValue={offer?.title}
            error={errors['title']}
            hint="E.g. Your free mini keychain"
          />
          <Field
            label="A line under it (optional)"
            name="description"
            maxLength={300}
            defaultValue={offer?.description ?? undefined}
            error={errors['description']}
            hint="E.g. With your name and number. One per customer."
          />
        </Panel>
        <Panel title="When and how many">
          <Field
            label="Starts (studio time)"
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={offer ? studioInput(offer.startsAt) : undefined}
            error={errors['startsAt']}
          />
          <Field
            label="Ends (studio time)"
            name="endsAt"
            type="datetime-local"
            required
            defaultValue={offer ? studioInput(offer.endsAt) : undefined}
            error={errors['endsAt']}
            hint="The banner counts down to it"
          />
          <Field
            label="How many to give (optional)"
            name="maxClaims"
            type="number"
            min={1}
            defaultValue={offer?.maxClaims ?? undefined}
            error={errors['maxClaims']}
            hint={
              offer
                ? `${offer.claimed} claimed so far. Empty: no limit until it ends`
                : 'Empty: no limit until it ends'
            }
          />
          <CheckboxField
            label="Running"
            name="active"
            defaultChecked={offer?.active ?? true}
            hint="Untick to stop it at once (orders already placed keep theirs)"
          />
        </Panel>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={fetcher.state !== 'idle'}>
          {offer ? 'Save' : 'Add offer'}
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </div>
    </fetcher.Form>
  );
}

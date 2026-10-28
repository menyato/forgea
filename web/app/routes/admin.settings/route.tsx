import type { StoreSettings } from '@forgea/types';
import {
  UpdateRequestSettingsDto,
  UpdateStoreSettingsDto,
} from '@forgea/validation';
import { useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { CheckboxField, Field, TextAreaField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import {
  checked,
  type SaveResult,
  save,
  text,
} from '~/features/admin/staff.server';
import { WhatsAppLink } from '~/features/contact/whatsapp-link';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

export async function loader({ context }: Route.LoaderArgs) {
  const r = await context.get(apiContext).get<StoreSettings>('/store-settings');
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return { settings: r.data };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get('intent') === 'requests') {
    return save(
      UpdateRequestSettingsDto,
      {
        quoteValidityDays: text(form, 'quoteValidityDays'),
        depositRefundable: checked(form, 'depositRefundable'),
        customUploadMaxMb: text(form, 'customUploadMaxMb'),
        estimateSolidityPercent: text(form, 'estimateSolidityPercent'),
        estimateSpreadPercent: text(form, 'estimateSpreadPercent'),
      },
      (dto) =>
        context.get(apiContext).put('/store-settings/custom-requests', dto),
    );
  }
  return save(
    UpdateStoreSettingsDto,
    {
      transferPhone: text(form, 'transferPhone'),
      transferInstructions: text(form, 'transferInstructions'),
      whatsappPhone: text(form, 'whatsappPhone'),
    },
    (dto) => context.get(apiContext).put('/store-settings', dto),
  );
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { settings } = loaderData;
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <>
      <AdminHeader
        title="Payment & requests"
        intro="Where customers send money and WhatsApp messages, and your rules for custom requests. Changes show on the site at once and are logged."
      />
      <Panel>
        <fetcher.Form method="post" className="grid max-w-xl gap-4">
          <Field
            label="Money transfer number"
            name="transferPhone"
            type="tel"
            required
            defaultValue={settings.transferPhone}
            error={errors['transferPhone']}
            hint="Shown at checkout and on the order confirmation"
          />
          <TextAreaField
            label="Transfer instructions (optional)"
            name="transferInstructions"
            defaultValue={settings.transferInstructions ?? undefined}
            error={errors['transferInstructions']}
            hint="e.g. Whish or OMT — write your order number in the note"
          />
          <Field
            label="WhatsApp number"
            name="whatsappPhone"
            type="tel"
            required
            defaultValue={settings.whatsappPhone}
            error={errors['whatsappPhone']}
            hint="Local numbers get +961 automatically"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={fetcher.state !== 'idle'}>
              Save
            </Button>
            <WhatsAppLink
              phone={settings.whatsappPhone}
              message="Test from the Forgea dashboard"
              className="text-sm underline underline-offset-4"
            >
              Test the WhatsApp link
            </WhatsAppLink>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        </fetcher.Form>
      </Panel>
      <RequestRules settings={settings} />
    </>
  );
}

function RequestRules({ settings }: { settings: StoreSettings }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  const rules = settings.requests;
  return (
    <Panel title="Custom requests" className="mt-6">
      <fetcher.Form method="post" className="grid max-w-xl gap-4">
        <input type="hidden" name="intent" value="requests" />
        <Field
          label="A quote stays open for (days)"
          name="quoteValidityDays"
          type="number"
          min={1}
          max={90}
          required
          defaultValue={rules.quoteValidityDays}
          error={errors['quoteValidityDays']}
        />
        <CheckboxField
          label="Refund the deposit if the customer cancels before printing starts"
          name="depositRefundable"
          defaultChecked={rules.depositRefundable}
        />
        <Field
          label="Largest file a customer can attach (MB)"
          name="customUploadMaxMb"
          type="number"
          min={1}
          max={100}
          required
          defaultValue={rules.customUploadMaxMb}
          error={errors['customUploadMaxMb']}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Instant estimate: how solid (%)"
            name="estimateSolidityPercent"
            type="number"
            min={5}
            max={100}
            required
            defaultValue={rules.estimateSolidityPercent}
            error={errors['estimateSolidityPercent']}
            hint="Walls and infill as a share of the model"
          />
          <Field
            label="Instant estimate: range (± %)"
            name="estimateSpreadPercent"
            type="number"
            min={0}
            max={100}
            required
            defaultValue={rules.estimateSpreadPercent}
            error={errors['estimateSpreadPercent']}
            hint="How wide the shown price range is"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Save the rules
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}

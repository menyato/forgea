import {
  QUOTATION_EMAIL_DEFAULTS,
  type QuotationEmailSettings,
  type StoreSettings,
} from '@forgea/types';
import {
  UpdateQuotationEmailDto,
  DeliveryAreasDto,
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
  const api = context.get(apiContext);
  const [r, email] = await Promise.all([
    api.get<StoreSettings>('/store-settings'),
    api.get<QuotationEmailSettings>('/store-settings/quotation-email'),
  ]);
  if (!r.ok) throw new Response(r.message, { status: r.status });
  return {
    settings: r.data,
    email: email.ok
      ? email.data
      : { subject: null, intro: null, closing: null },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get('intent') === 'email') {
    return save(
      UpdateQuotationEmailDto,
      {
        subject: text(form, 'subject'),
        intro: text(form, 'intro'),
        closing: text(form, 'closing'),
      },
      (dto) =>
        context.get(apiContext).put('/store-settings/quotation-email', dto),
    );
  }
  if (form.get('intent') === 'areas') {
    // One area per line.
    const areas = String(form.get('areas') ?? '')
      .split(/\r?\n/)
      .map((a) => a.trim())
      .filter(Boolean);
    return save(DeliveryAreasDto, { areas }, (dto) =>
      context.get(apiContext).put('/store-settings/delivery-areas', dto),
    );
  }
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
        title="Payment, requests & emails"
        intro="Where customers send money and WhatsApp messages, your rules for custom requests, and the words of the quotation email. Changes apply at once and are logged."
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
      <DeliveryAreas areas={settings.deliveryAreas} />
      <RequestRules settings={settings} />
      <QuotationEmail email={loaderData.email} />
    </>
  );
}

/** Where the studio delivers: checkout and quotations offer only these. */
function DeliveryAreas({ areas }: { areas: string[] }) {
  const fetcher = useFetcher<SaveResult>();
  return (
    <Panel title="Delivery areas" className="mt-6">
      <fetcher.Form method="post" className="grid max-w-xl gap-3">
        <input type="hidden" name="intent" value="areas" />
        <TextAreaField
          label="One area per line"
          name="areas"
          rows={12}
          defaultValue={areas.join('\n')}
          hint="Customers choose one of these at checkout, and you choose one on a quotation. Orders already placed keep the area they had."
          error={fetcher.data?.errors?.['areas']}
        />
        <Button
          type="submit"
          variant="secondary"
          className="justify-self-start"
          disabled={fetcher.state !== 'idle'}
        >
          Save the areas
        </Button>
        <SaveStatus state={fetcher.state} result={fetcher.data} />
      </fetcher.Form>
    </Panel>
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

/** The quotation email's own words; an empty box sends the standard wording. */
function QuotationEmail({ email }: { email: QuotationEmailSettings }) {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <Panel title="Quotation email" className="mt-6">
      <p className="max-w-2xl text-sm text-text-muted">
        What the customer reads around their quotation. The lines, sizes, total
        and the button to accept it online are always added between the
        introduction and the closing. You can write {'{name}'}, {'{number}'},{' '}
        {'{total}'} and {'{validUntil}'}; leave a box empty for the standard
        words shown in it.
      </p>
      <fetcher.Form method="post" className="grid max-w-2xl gap-4">
        <input type="hidden" name="intent" value="email" />
        <Field
          label="Subject"
          name="subject"
          maxLength={150}
          defaultValue={email.subject ?? ''}
          placeholder={QUOTATION_EMAIL_DEFAULTS.subject}
          error={errors['subject']}
        />
        <TextAreaField
          label="Introduction"
          name="intro"
          rows={5}
          maxLength={2000}
          defaultValue={email.intro ?? ''}
          placeholder={QUOTATION_EMAIL_DEFAULTS.intro}
          error={errors['intro']}
        />
        <TextAreaField
          label="Closing"
          name="closing"
          rows={5}
          maxLength={2000}
          defaultValue={email.closing ?? ''}
          placeholder={QUOTATION_EMAIL_DEFAULTS.closing}
          error={errors['closing']}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={fetcher.state !== 'idle'}>
            Save the email
          </Button>
          <SaveStatus state={fetcher.state} result={fetcher.data} />
        </div>
      </fetcher.Form>
    </Panel>
  );
}

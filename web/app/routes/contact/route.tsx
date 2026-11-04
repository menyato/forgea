import { CreateLeadDto } from '@forgea/validation';
import { BUDGET_RANGES, type BudgetRange } from '@forgea/validation/constants';
import { data, Form, Link, useNavigation } from 'react-router';
import { Busy } from '~/components/brand/busy';
import { PAGE_WIDTH } from '~/components/layout/page-width';
import { Button } from '~/components/ui/button';
import {
  Field,
  FormAlert,
  SelectField,
  TextAreaField,
} from '~/components/ui/field';
import { seoMeta, siteOrigin } from '~/features/seo/seo';
import { type FieldErrors, textFields, validateForm } from '~/lib/forms.server';
import { apiContext } from '~/lib/request.server';
import { readUploadForm } from '~/lib/upload-guard.server';
import type { Route } from './+types/route';

export function meta({ matches }: Route.MetaArgs) {
  return seoMeta({
    origin: siteOrigin(matches),
    path: '/contact',
    title: 'Tell us your idea — Forgea',
    description:
      'A gift, a part, a prototype: describe it and the studio gets back to you. No account needed.',
  });
}

const BUDGET_LABELS: Record<BudgetRange, string> = {
  'under-100': 'Under $100',
  '100-500': '$100 – $500',
  '500-2500': '$500 – $2,500',
  'over-2500': 'Over $2,500',
};

type ActionResult =
  { sent: true } | { sent: false; errors: FieldErrors; message?: string };

/**
 * The custom-design form for visitors without an account. It becomes a lead in the
 * dashboard (Leads), where the team follows up and can write a quotation.
 */
export async function action({ request, context }: Route.ActionArgs) {
  // Public: no sign-in, but large bodies are still read a few at a time.
  const form = await readUploadForm(request, null);
  const fields = textFields(form, [
    'name',
    'email',
    'phone',
    'message',
    'budgetRange',
  ]);
  const parsed = validateForm(CreateLeadDto, fields);
  if (!parsed.ok) {
    return data<ActionResult>(
      { sent: false, errors: parsed.errors },
      { status: 400 },
    );
  }
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const image = form.get('referenceImage');
  if (image instanceof File && image.size > 0) {
    body.set('referenceImage', image, image.name);
  }
  const r = await context
    .get(apiContext)
    .postForm<{ id: string }>('/leads', body);
  return r.ok
    ? data<ActionResult>({ sent: true })
    : data<ActionResult>(
        { sent: false, errors: {}, message: r.message },
        { status: r.status },
      );
}

export default function Contact({ actionData }: Route.ComponentProps) {
  const sending = useNavigation().state === 'submitting';
  if (actionData?.sent) {
    return (
      <main className={`${PAGE_WIDTH} grid max-w-2xl gap-5 py-16`}>
        <h1 className="font-display text-4xl font-extrabold">
          Thank you, we have your idea
        </h1>
        <p className="text-text-muted">
          The studio will reply by email, usually within a working day.
        </p>
        <Link to="/shop" className="underline underline-offset-4">
          Meanwhile, browse the shop
        </Link>
      </main>
    );
  }
  const errors = actionData && !actionData.sent ? actionData.errors : {};
  return (
    <main className={`${PAGE_WIDTH} grid max-w-2xl gap-6 py-10`}>
      <header className="grid gap-2">
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-none font-extrabold tracking-tight">
          Tell us your idea
        </h1>
        <p className="text-text-muted">
          A gift, a spare part, a prototype or an electronics enclosure:
          describe it and we get back to you with questions or a quotation. No
          account needed. Have a 3D file?{' '}
          <Link to="/custom" className="underline underline-offset-4">
            The custom order form
          </Link>{' '}
          gives an instant price.
        </p>
      </header>
      <Form
        method="post"
        encType="multipart/form-data"
        className="grid gap-4 rounded-lg bg-surface p-6"
      >
        <FormAlert
          message={
            actionData && !actionData.sent ? actionData.message : undefined
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Your name"
            name="name"
            required
            autoComplete="name"
            error={errors['name']}
          />
          <Field
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            error={errors['email']}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Phone (optional)"
            name="phone"
            type="tel"
            autoComplete="tel"
            error={errors['phone']}
          />
          <SelectField
            label="Budget (optional)"
            name="budgetRange"
            defaultValue=""
            error={errors['budgetRange']}
          >
            <option value="">Not sure yet</option>
            {BUDGET_RANGES.map((b) => (
              <option key={b} value={b}>
                {BUDGET_LABELS[b]}
              </option>
            ))}
          </SelectField>
        </div>
        <TextAreaField
          label="What would you like us to make?"
          name="message"
          required
          rows={6}
          error={errors['message']}
        />
        <Field
          label="A picture or sketch (optional, up to 10 MB)"
          name="referenceImage"
          type="file"
          accept="image/png,image/jpeg,image/webp"
        />
        <Button
          type="submit"
          disabled={sending}
          className="justify-self-start px-6 py-3"
        >
          {sending ? <Busy label="Sending…" /> : 'Send my idea'}
        </Button>
      </Form>
    </main>
  );
}

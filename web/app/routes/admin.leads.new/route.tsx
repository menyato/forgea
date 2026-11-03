import { SaveLeadDto } from '@forgea/validation';
import { redirect, useFetcher } from 'react-router';
import { Button } from '~/components/ui/button';
import { Field, TextAreaField } from '~/components/ui/field';
import { AdminHeader, Panel, SaveStatus } from '~/features/admin/admin-ui';
import { type SaveResult, save, text } from '~/features/admin/staff.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/** A lead the team adds; opens its page. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  let createdId: string | undefined;
  const result = await save(
    SaveLeadDto,
    {
      name: text(form, 'name'),
      email: text(form, 'email'),
      phone: text(form, 'phone'),
      message: text(form, 'message'),
      expectedRevenue: text(form, 'expectedRevenue'),
      deadline: text(form, 'deadline'),
    },
    async (dto) => {
      const r = await context
        .get(apiContext)
        .post<{ id: string }>('/leads/manual', dto);
      if (r.ok) createdId = r.data.id;
      return r;
    },
  );
  if (createdId) throw redirect(`/admin/leads/${createdId}`);
  return result;
}

export default function NewLead() {
  const fetcher = useFetcher<SaveResult>();
  const errors = fetcher.data?.errors ?? {};
  return (
    <>
      <AdminHeader
        title="New lead"
        intro="Someone who asked in the studio, by phone or on social media. It starts in the first stage."
        trail={[{ label: 'Leads', to: '/admin/leads' }]}
      />
      <Panel>
        <fetcher.Form method="post" className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" name="name" required error={errors['name']} />
          <Field
            label="Email"
            name="email"
            type="email"
            required
            error={errors['email']}
          />
          <Field
            label="Phone (optional)"
            name="phone"
            type="tel"
            error={errors['phone']}
          />
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Expected revenue (USD)"
              name="expectedRevenue"
              inputMode="decimal"
              error={errors['expectedRevenue']}
            />
            <Field
              label="Expected closing"
              name="deadline"
              type="date"
              error={errors['deadline']}
            />
          </div>
          <div className="sm:col-span-2">
            <TextAreaField
              label="What do they need?"
              name="message"
              required
              error={errors['message']}
            />
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={fetcher.state !== 'idle'}>
              Add the lead
            </Button>
            <SaveStatus state={fetcher.state} result={fetcher.data} />
          </div>
        </fetcher.Form>
      </Panel>
    </>
  );
}

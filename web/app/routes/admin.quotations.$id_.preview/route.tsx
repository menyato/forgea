import type { QuotationDetail } from '@forgea/types';
import { Link } from 'react-router';
import { QuotationDocument } from '~/features/quotations/quotation-document';
import { quotationExtras } from '~/features/quotations/quotation-extras.server';
import { apiContext } from '~/lib/request.server';
import type { Route } from './+types/route';

/**
 * A quotation as its customer sees it, opened from the dashboard: the same page as theirs
 * (each piece in 3D, the lines, what to pay), without their buttons.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const api = context.get(apiContext);
  const q = await api.get<QuotationDetail>(
    `/quotations/${encodeURIComponent(params.id)}`,
  );
  if (!q.ok) throw new Response(q.message, { status: q.status });
  // The customer never gets a line's print file.
  const quotation: QuotationDetail = {
    ...q.data,
    lines: q.data.lines.map((l) => ({ ...l, printFile: null })),
  };
  return { quotation, ...(await quotationExtras(api, quotation)) };
}

export default function QuotationPreview({ loaderData }: Route.ComponentProps) {
  const { quotation: q } = loaderData;
  return (
    <div className="grid gap-2">
      <p
        role="note"
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-4 text-sm"
      >
        <span>
          What <strong>{q.customerName}</strong> sees
          {q.status === 'DRAFT' ? ' once you send it' : ''}. Their buttons
          (accept, decline) are left out here.
        </span>
        <Link
          to={`/admin/quotations/${q.id}`}
          className="underline underline-offset-4"
        >
          Back to the quotation
        </Link>
      </p>
      <QuotationDocument {...loaderData} result={null} error={null} preview />
    </div>
  );
}

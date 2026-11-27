import { studioFormat } from '~/lib/studio-time';

const WHEN = studioFormat({ dateStyle: 'medium', timeStyle: 'medium' });

/** An audit entry's time, as the studio reads it. */
export const auditTime = (iso: string) => WHEN.format(new Date(iso));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Each record type's dashboard page, for the records that have one (by id). */
const PAGES: Record<string, string> = {
  Order: '/admin/orders',
  Quotation: '/admin/quotations',
  CustomRequest: '/admin/requests',
  Lead: '/admin/leads',
  LeadStage: '/admin/lead-stages',
  LostReason: '/admin/lost-reasons',
  Product: '/admin/products',
  Category: '/admin/categories',
  Material: '/admin/materials',
  OptionGroup: '/admin/options',
  Font: '/admin/fonts',
  PrintJob: '/admin/production',
  Invoice: '/admin/accounting/invoices',
  JournalEntry: '/admin/accounting/books/entries',
  StockItem: '/admin/stock',
  StockMovement: '/admin/stock/movements',
};

/** The page of the record an entry is about, when it has one ("new" and settings don't). */
export function recordPage(
  targetType: string,
  targetId: string,
): string | null {
  if (targetType === 'Currency' && /^[A-Z]{3}$/.test(targetId))
    return targetId === 'USD' ? null : `/admin/currencies/${targetId}`;
  const list = PAGES[targetType];
  return list && UUID.test(targetId) ? `${list}/${targetId}` : null;
}

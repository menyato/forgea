import type { PrinterView, StockOverview } from '@forgea/types';
import type { ApiClient } from '~/lib/api-client.server';

export interface Choice {
  id: string;
  label: string;
}

/**
 * What a print job is planned with: the printers in use and the reels in stock (a material
 * and a colour, with what is on the shelf), never typed in.
 */
export async function productionChoices(
  api: ApiClient,
): Promise<{ printers: Choice[]; reels: Choice[] }> {
  const [printers, stock] = await Promise.all([
    api.get<PrinterView[]>('/printers'),
    api.get<StockOverview>('/stock'),
  ]);
  return {
    printers: printers.ok
      ? printers.data
          .filter((p) => p.active)
          .map((p) => ({ id: p.id, label: `${p.name} (${p.watts} W)` }))
      : [],
    reels: stock.ok
      ? stock.data.items
          .filter((i) => i.active)
          .map((i) => ({
            id: i.id,
            label: `${i.material.code} · ${i.colour || 'no colour'} · ${i.stockGrams} g on the shelf`,
          }))
      : [],
  };
}

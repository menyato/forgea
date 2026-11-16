import type { FilamentChoice, PrinterView } from '@forgea/types';
import type { ApiClient } from '~/lib/api-client.server';

export interface Choice {
  id: string;
  label: string;
}

/** The filaments on the shelf a form may choose from; none for someone who can't see the stock. */
export async function filamentChoices(
  api: ApiClient,
): Promise<FilamentChoice[]> {
  const r = await api.get<FilamentChoice[]>('/stock/filaments');
  return r.ok ? r.data : [];
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
    filamentChoices(api),
  ]);
  return {
    printers: printers.ok
      ? printers.data
          .filter((p) => p.active)
          .map((p) => ({ id: p.id, label: `${p.name} (${p.watts} W)` }))
      : [],
    reels: stock.map((i) => ({
      id: i.id,
      label: `${i.material} · ${i.colour || 'no colour'} · ${i.stockGrams} g on the shelf`,
    })),
  };
}

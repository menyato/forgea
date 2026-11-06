import type { Page } from '@forgea/types';
import type { ApiClient } from './api-client.server';

/**
 * Every item of a paged list, page by page (up to 50 pages of `path`'s limit): pickers that
 * offer the whole catalog keep working once it is past one page.
 */
export async function allPages<T>(api: ApiClient, path: string): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const url: string = cursor
      ? `${path}&cursor=${encodeURIComponent(cursor)}`
      : path;
    const r = await api.get<Page<T>>(url);
    if (!r.ok) break;
    items.push(...r.data.items);
    cursor = r.data.nextCursor;
    if (!cursor) break;
  }
  return items;
}

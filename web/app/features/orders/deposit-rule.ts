import type { OrderSettings } from '@forgea/pricing';

/**
 * The shop's deposit rule in the customer's words ("A 50% deposit starts orders above $30."),
 * or null when no order pays one.
 */
export function depositRule(s: OrderSettings): string | null {
  const percent = Number(s.depositPercent);
  if (!s.depositEnabled || !(percent > 0)) return null;
  const above =
    s.depositAboveTotal === null
      ? null
      : `orders above $${Number(s.depositAboveTotal)}`;
  const on = [s.depositOnCustom ? 'made-to-order pieces' : null, above]
    .filter((x): x is string => x !== null)
    .join(' and ');
  return on ? `A ${percent}% deposit starts ${on}.` : null;
}

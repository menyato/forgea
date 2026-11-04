/** The decline form's reason, trimmed and capped as the API takes it (none when blank). */
export function declineBody(form: FormData): { reason?: string } {
  const reason = form.get('reason');
  const text = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
  return text ? { reason: text } : {};
}

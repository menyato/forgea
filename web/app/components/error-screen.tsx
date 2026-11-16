import { isRouteErrorResponse, Link } from 'react-router';
import { PrintingLogo } from './brand/printing-logo';

/**
 * What went wrong, in the visitor's words, with a way back. One screen for the shop and the
 * dashboard (which shows it inside its own frame, menu and all).
 */
export function ErrorScreen({
  error,
  back = { to: '/', label: 'Back to the home page' },
}: {
  error: unknown;
  back?: { to: string; label: string };
}) {
  let title = 'Something went wrong';
  let details = 'Please try again in a moment.';
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = 'Page not found';
      details = "That page doesn't exist, or it has moved.";
    } else if (error.status === 403) {
      title = 'Not allowed';
      // Our own refusals say why (e.g. a dashboard page someone's permissions don't cover).
      details =
        typeof error.data === 'string' && error.data
          ? error.data
          : 'This request was refused.';
    } else if (error.status === 429 || error.status === 503) {
      title = 'One moment';
      details =
        'We are getting a lot of requests right now. Please wait a few seconds and reload.';
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto grid max-w-3xl gap-4 px-4 py-16">
      <PrintingLogo className="w-24" />
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <p className="text-text-muted">{details}</p>
      <p>
        <Link to={back.to} className="underline underline-offset-4">
          {back.label}
        </Link>
      </p>
      {stack && (
        <pre className="overflow-x-auto rounded-md bg-surface p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}

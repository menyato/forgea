import { data } from 'react-router';
import type { ApiClient } from './api-client.server';

/** Above this, a request body counts as a file upload. */
const LARGE_BODY = 1024 * 1024;
/** Large bodies read at the same time by this server, at most. */
const MAX_PARALLEL = 3;
let inProgress = 0;

/**
 * Reads a form that may carry a large file, only once it is worth it: this server reads at most
 * a few large bodies at once, and (unless `api` is null, for public forms) the visitor must
 * really be signed in, not just send a cookie. Others are turned away before the body is read.
 */
export async function readUploadForm(
  request: Request,
  api: ApiClient | null,
): Promise<FormData> {
  // No declared length (a chunked upload) counts as large.
  const length = Number(request.headers.get('content-length') ?? Infinity);
  if (length <= LARGE_BODY) return request.formData();
  if (api && !(await api.get('/auth/me')).ok) {
    throw data(
      { error: 'Sign in again, then send the file.' },
      { status: 401 },
    );
  }
  if (inProgress >= MAX_PARALLEL) {
    throw data(
      { error: 'Busy receiving other files. Try again in a moment.' },
      { status: 503 },
    );
  }
  inProgress++;
  try {
    return await request.formData();
  } finally {
    inProgress--;
  }
}

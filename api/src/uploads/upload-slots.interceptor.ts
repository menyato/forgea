import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { finalize, type Observable } from 'rxjs';

/** Big uploads read at the same time, at most: each is held in memory while it arrives. */
const MAX_PARALLEL_UPLOADS = 3;
let inProgress = 0;

/**
 * Put it BEFORE the FileInterceptor in `@UseInterceptors(UploadSlots, FileInterceptor(…))`:
 * an upload beyond the limit is turned away before its body is read, so a burst of large
 * uploads can't fill the server's memory. The browser shows "busy, try again".
 */
@Injectable()
export class UploadSlots implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (inProgress >= MAX_PARALLEL_UPLOADS) {
      throw new ServiceUnavailableException(
        'Busy receiving other files. Try again in a moment.',
      );
    }
    inProgress++;
    return next.handle().pipe(finalize(() => inProgress--));
  }
}

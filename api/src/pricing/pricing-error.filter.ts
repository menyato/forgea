import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { PricingError } from '@forgea/pricing';
import type { Response } from 'express';

/** Invalid pricing input is the caller's mistake: answer 400 with the engine's message. */
@Catch(PricingError)
export class PricingErrorFilter implements ExceptionFilter {
  catch(error: PricingError, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.BAD_REQUEST)
      .json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: error.message,
        error: 'Bad Request',
      });
  }
}

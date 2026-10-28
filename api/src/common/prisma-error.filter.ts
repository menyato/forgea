import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

/** Known database refusals that are the caller's mistake, with a message the dashboard can show. */
const ANSWERS: Readonly<
  Record<string, { status: HttpStatus; message: string }>
> = {
  // Unique constraint, e.g. a slug or name that already exists.
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'That name or address is already used',
  },
  // Foreign key: refers to a row that doesn't exist, or a row still in use can't be removed.
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    message:
      'This refers to something that no longer exists, or is still in use',
  },
  // The row to update was not found.
  P2025: { status: HttpStatus.NOT_FOUND, message: 'Not found' },
};

/** Anything else from the database is a 500: logged here, its details never sent to the client. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaErrorFilter.name);

  catch(
    error: Prisma.PrismaClientKnownRequestError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    const answer = ANSWERS[error.code];
    if (!answer) {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      });
      this.logger.error(error.message, error.stack);
      return;
    }
    response
      .status(answer.status)
      .json({ statusCode: answer.status, message: answer.message });
  }
}

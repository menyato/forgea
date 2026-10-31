import { periodError } from '@forgea/types';
import {
  Matches,
  Validate,
  ValidateIf,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Both dates make a real period of two years at most (the rule lives in @forgea/types). */
@ValidatorConstraint({ name: 'period' })
class PeriodRule implements ValidatorConstraintInterface {
  validate(_: unknown, args: ValidationArguments): boolean {
    const q = args.object as PeriodQuery;
    return periodError(q.from, q.to) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    const q = args.object as PeriodQuery;
    return periodError(q.from, q.to) ?? 'Choose a period';
  }
}

const either = (q: PeriodQuery) => q.from !== undefined || q.to !== undefined;

/**
 * `?from=2026-10-01&to=2026-10-31`: whole days, both or neither (neither: the page's default
 * period). The business dashboard and filament use by product.
 */
export class PeriodQuery {
  @ValidateIf(either)
  @Matches(DATE_ONLY, { message: 'Choose a start date' })
  from?: string;

  @ValidateIf(either)
  @Matches(DATE_ONLY, { message: 'Choose an end date' })
  @Validate(PeriodRule)
  to?: string;
}

import { NotFoundException, type PipeTransform } from '@nestjs/common';

/** A route parameter that must match a pattern (e.g. "CR-…"); anything else is a 404. */
export class ParsePatternPipe implements PipeTransform<string, string> {
  constructor(
    private readonly pattern: RegExp,
    private readonly message: string,
  ) {}

  transform(value: string): string {
    if (!this.pattern.test(value)) throw new NotFoundException(this.message);
    return value;
  }
}

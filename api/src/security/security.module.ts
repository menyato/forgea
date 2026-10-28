import { Global, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { OriginPolicy } from './origin-policy.js';
import { DEFAULT_THROTTLERS } from './throttle-policies.js';

/** Cross-cutting request security. The guards themselves are registered in AppModule. */
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: DEFAULT_THROTTLERS,
      errorMessage: 'Too many requests. Please wait a moment and try again.',
    }),
  ],
  providers: [OriginPolicy],
  exports: [OriginPolicy, ThrottlerModule],
})
export class SecurityModule {}

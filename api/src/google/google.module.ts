import { Module } from '@nestjs/common';
import { GoogleCalendar } from './google-calendar.js';
import { GoogleServiceAccount } from './google-service-account.js';

/** The Workspace service account shared by email and the calendar (Phase 9). */
@Module({
  providers: [GoogleServiceAccount, GoogleCalendar],
  exports: [GoogleServiceAccount, GoogleCalendar],
})
export class GoogleModule {}

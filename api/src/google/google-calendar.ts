import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/environment.js';
import { GoogleServiceAccount } from './google-service-account.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export interface CalendarEvent {
  summary: string;
  description: string;
  start: Date;
  end: Date;
}

/**
 * The studio's Google Calendar (GOOGLE_CALENDAR_ID), through the Workspace service account.
 * Without it (development, tests) changes are only logged and no event ids are kept.
 */
@Injectable()
export class GoogleCalendar {
  private readonly logger = new Logger(GoogleCalendar.name);
  private readonly calendarId: string | null;
  /** Replaced in tests. */
  protected fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    private readonly google: GoogleServiceAccount,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.calendarId = config.get('GOOGLE_CALENDAR_ID', { infer: true }) ?? null;
  }

  get configured(): boolean {
    return this.google.configured && this.calendarId !== null;
  }

  /** Creates the event, or updates it when `eventId` is given. Returns its id (null if off). */
  async upsert(
    eventId: string | null,
    event: CalendarEvent,
  ): Promise<string | null> {
    if (!this.configured) {
      this.logger.log(
        `Calendar off: would ${eventId ? 'update' : 'add'} "${event.summary}" at ${event.start.toISOString()}`,
      );
      return null;
    }
    const base = this.eventsUrl();
    const res = await this.call(
      eventId ? `${base}/${encodeURIComponent(eventId)}` : base,
      {
        method: eventId ? 'PUT' : 'POST',
        body: JSON.stringify({
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start.toISOString() },
          end: { dateTime: event.end.toISOString() },
        }),
      },
    );
    return ((await res.json()) as { id: string }).id;
  }

  async remove(eventId: string): Promise<void> {
    if (!this.configured) {
      this.logger.log(`Calendar off: would remove event ${eventId}`);
      return;
    }
    await this.call(`${this.eventsUrl()}/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });
  }

  private eventsUrl(): string {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId!)}/events`;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    const token = await this.google.accessToken(SCOPE);
    const res = await this.fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    // An event someone already deleted in Google Calendar is fine to forget.
    if (!res.ok && !(init.method === 'DELETE' && res.status === 410)) {
      throw new Error(`Google Calendar refused the change (${res.status})`);
    }
    return res;
  }
}

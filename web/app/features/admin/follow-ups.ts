import { studioFormat } from '~/lib/studio-time';

/** What a follow-up is: a call, an email, a meeting or something to do. */
export const FOLLOW_UP_KINDS = {
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
  TODO: 'To-do',
} as const;

/** "Fri 6 Nov, 14:30", in studio time. */
export const followUpTime = studioFormat({
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

import { PrintJobStatus } from '@forgea/types';

/** A print run's way through the studio: the kanban's columns and its page's status bar. */
export const PRINT_JOB_STEPS = [
  PrintJobStatus.QUEUED,
  PrintJobStatus.SCHEDULED,
  PrintJobStatus.PRINTING,
  PrintJobStatus.DONE,
] as const;

/** Off the main path: shown beside the steps, not as one of them. */
export const PRINT_JOB_ASIDE: readonly PrintJobStatus[] = [
  PrintJobStatus.FAILED,
  PrintJobStatus.CANCELLED,
];

/** Every status in the order it happens (groups and filters). */
export const PRINT_JOB_ORDER: readonly PrintJobStatus[] = [
  ...PRINT_JOB_STEPS,
  ...PRINT_JOB_ASIDE,
];

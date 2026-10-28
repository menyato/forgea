import { PrintJobStatus } from './generated/prisma/enums.js';

/** Which step may follow which on the production board. Done and cancelled are final. */
export const PRINT_JOB_FLOW: Readonly<
  Record<PrintJobStatus, readonly PrintJobStatus[]>
> = {
  [PrintJobStatus.QUEUED]: [
    PrintJobStatus.SCHEDULED,
    PrintJobStatus.PRINTING,
    PrintJobStatus.CANCELLED,
  ],
  [PrintJobStatus.SCHEDULED]: [
    PrintJobStatus.QUEUED,
    PrintJobStatus.PRINTING,
    PrintJobStatus.CANCELLED,
  ],
  [PrintJobStatus.PRINTING]: [PrintJobStatus.DONE, PrintJobStatus.FAILED],
  // A failed print goes back in the queue to be printed again.
  [PrintJobStatus.FAILED]: [PrintJobStatus.QUEUED, PrintJobStatus.CANCELLED],
  [PrintJobStatus.DONE]: [],
  [PrintJobStatus.CANCELLED]: [],
};

export const PRINT_JOB_STATUS_LABELS: Readonly<Record<PrintJobStatus, string>> =
  {
    [PrintJobStatus.QUEUED]: 'Waiting',
    [PrintJobStatus.SCHEDULED]: 'Scheduled',
    [PrintJobStatus.PRINTING]: 'Printing',
    [PrintJobStatus.DONE]: 'Done',
    [PrintJobStatus.FAILED]: 'Failed',
    [PrintJobStatus.CANCELLED]: 'Cancelled',
  };

/** A print uses its filament when it finishes or fails: that is when stock goes down. */
export const PRINT_JOB_USES_MATERIAL: readonly PrintJobStatus[] = [
  PrintJobStatus.DONE,
  PrintJobStatus.FAILED,
];

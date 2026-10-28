import { describe, expect, it } from 'vitest';
import { PrintJobStatus } from './generated/prisma/enums.js';
import { PRINT_JOB_FLOW, PRINT_JOB_STATUS_LABELS } from './print-jobs.js';

describe('PRINT_JOB_FLOW', () => {
  it('ends at done and cancelled, and only re-queues failed prints', () => {
    expect(PRINT_JOB_FLOW.DONE).toEqual([]);
    expect(PRINT_JOB_FLOW.CANCELLED).toEqual([]);
    expect(PRINT_JOB_FLOW.FAILED).toContain(PrintJobStatus.QUEUED);
    expect(PRINT_JOB_FLOW.PRINTING).not.toContain(PrintJobStatus.CANCELLED);
  });

  it('names every status', () => {
    expect(Object.keys(PRINT_JOB_STATUS_LABELS).sort()).toEqual(
      Object.values(PrintJobStatus).sort(),
    );
  });
});

/** Where a figure's print jobs are: the production list, filtered. */
export const printerJobs = (printerId: string) =>
  `/admin/production?view=list&filter=${encodeURIComponent(`printer:${printerId}`)}`;

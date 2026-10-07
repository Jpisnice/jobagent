import { defineTool } from "eve/tools";
import { z } from "zod";
import { JOB_STATUSES, listJobs, type JobStatus } from "../lib/store";

export default defineTool({
  description:
    "List jobs from the store, newest first, with a count per status. Use it to answer questions about past results, such as which jobs were emailed (notified), approved but not yet applied, applied to, failed or skipped, optionally since a date.",
  inputSchema: z.object({
    status: z
      .array(z.enum(JOB_STATUSES as [JobStatus, ...JobStatus[]]))
      .optional()
      .describe("Only these statuses; omit for all"),
    since: z.string().optional().describe("Only jobs updated on or after this ISO date, for example 2026-10-01"),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  label: {
    start: ({ status }) => (status?.length ? `List ${status.join("/")} jobs` : "List jobs"),
  },
  async execute(input) {
    return listJobs(input);
  },
});

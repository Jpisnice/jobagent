import { defineTool } from "eve/tools";
import { z } from "zod";
import { upsertJob } from "../lib/store";

export default defineTool({
  description: "Record or update a job's status in the store so it is never alerted on or applied to twice.",
  inputSchema: z.object({
    url: z.string().url(),
    title: z.string(),
    company: z.string(),
    score: z.number().min(0).max(100).optional(),
    status: z.enum(["seen", "notified", "approved", "applied", "failed", "skipped"]),
    note: z.string().optional(),
  }),
  label: {
    start: ({ company, title, status }) => `Mark ${company} – ${title} as ${status}`,
  },
  async execute(input) {
    return await upsertJob(input);
  },
});

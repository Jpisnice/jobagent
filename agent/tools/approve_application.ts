import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { upsertJob } from "../lib/store";

// This tool is the approval gate. It does nothing external; the browser
// submission happens only after this call is approved.
export default defineTool({
  description:
    "Ask the candidate to approve submitting an application. Must be approved before any form is filled or submitted.",
  inputSchema: z.object({
    url: z.string().url(),
    title: z.string(),
    company: z.string(),
    draft: z.string().describe("Cover letter / answers that will be submitted"),
  }),
  approval: always(),
  async execute({ url, title, company }) {
    await upsertJob({ url, title, company, status: "approved" });
    return { approved: true, url, next: "Fill and submit the form, then record_job with status applied or failed." };
  },
});

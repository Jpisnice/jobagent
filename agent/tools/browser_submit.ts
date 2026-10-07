import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { runTask } from "../lib/browser";

// The only tool that can press a final Submit button. Every call pauses for the user's approval.
export default defineTool({
  description:
    "Press the final Submit / Send application button on the form currently open in Chrome. Always asks the user for approval first. Only use it after browser_task reported the form is ready and approve_application was approved for this job.",
  inputSchema: z.object({
    jobUrl: z.string().url().describe("URL of the job being applied to"),
    summary: z.string().describe("One line on what is being submitted, shown in the approval prompt"),
  }),
  approval: always(),
  async execute({ summary }, ctx) {
    const r = await runTask(
      {
        task: `The application form is already filled in on the current page (${summary}). Press the final Submit button once, then report exactly what confirmation message or page appears. Do not change any field.`,
        maxSteps: 10,
        key: ctx.callId,
        allowSubmit: true,
      },
      ctx.abortSignal,
      4 * 60_000,
    );
    return {
      status: r.status,
      confirmation: r.result,
      reason: r.reason,
      next: "If a confirmation was shown, record_job with status applied; otherwise record it as failed with the reason.",
    };
  },
});

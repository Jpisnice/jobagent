import { defineTool } from "eve/tools";
import { z } from "zod";
import { runTask } from "../lib/browser";

export default defineTool({
  description:
    "Do a browser task in the user's real Chrome window using the local browser-use agent: open a page, click through to an application form, fill every field, upload files. Give it one complete, explicit task with the exact values to enter. It stops before the final Submit button. If it returns needs_human (login, CAPTCHA, verification code), ask the user with ask_question, then call this again with a task that continues on the current page.",
  inputSchema: z.object({
    task: z
      .string()
      .min(20)
      .describe(
        "Full instructions: the job URL (or 'continue on the current page'), then every field and the exact value to enter, plus any questions and the answers to give",
      ),
    files: z
      .array(z.string())
      .default([])
      .describe("Files from the project's data/ folder to upload, such as resume.pdf"),
    maxSteps: z.number().int().min(5).max(100).default(60),
  }),
  label: {
    start: ({ files }) => (files.length ? `Working in Chrome (uploading ${files.join(", ")})` : "Working in Chrome"),
    complete: (_input, output) => `Chrome: ${(output as { status: string }).status}`,
  },
  async execute({ task, files, maxSteps }, ctx) {
    const r = await runTask({ task, files, maxSteps, key: ctx.callId }, ctx.abortSignal);
    return {
      status: r.status,
      steps: r.steps,
      seconds: r.seconds,
      result: r.result,
      reason: r.reason,
      next:
        r.status === "needs_human"
          ? "Use ask_question to tell the user what to do in the Chrome window, wait for their answer, then call browser_task again to continue."
          : r.status === "needs_submit_approval"
            ? "The form is ready. Call browser_submit, which asks the user for approval."
            : r.status === "done"
              ? "Review the result. If the form is complete, call browser_submit."
              : "Record the job as failed with the reason unless one retry is clearly worthwhile.",
    };
  },
});

import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { refSelector, snapshot, withPage } from "../lib/chrome";

// The only way to press a final Submit button. Every call pauses for the user's approval.
export default defineTool({
  description:
    "Click the final Submit / Send application button (ref from the latest snapshot). Always asks the user for approval first. Only use it after approve_application was approved for this job and every form field has been checked.",
  inputSchema: z.object({
    ref: z.string().describe("Element ref of the submit button, such as e40"),
    jobUrl: z.string().url().describe("URL of the job being applied to"),
    summary: z.string().describe("One line on what is being submitted, for the approval prompt"),
  }),
  approval: always(),
  async execute({ ref }) {
    return withPage(async (page) => {
      await page.locator(refSelector(ref)).first().click({ timeout: 10_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      return snapshot(page);
    });
  },
});

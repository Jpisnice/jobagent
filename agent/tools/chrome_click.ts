import { defineTool } from "eve/tools";
import { z } from "zod";
import { describe, looksLikeFinalSubmit, refSelector, snapshot, withPage } from "../lib/chrome";

export default defineTool({
  description:
    "Click an element by ref from the latest snapshot and return the new page snapshot. Cannot click the final Submit/Send application button; use chrome_submit for that (it asks the user for approval).",
  inputSchema: z.object({ ref: z.string().describe("Element ref such as e12") }),
  async execute({ ref }) {
    return withPage(async (page) => {
      const el = await describe(page, ref);
      if (looksLikeFinalSubmit(el)) {
        return { blocked: true, reason: `"${el.label}" looks like the final submit. Use chrome_submit with this ref.` };
      }
      await page.locator(refSelector(ref)).first().click({ timeout: 10_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      return snapshot(page);
    });
  },
});

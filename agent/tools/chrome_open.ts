import { defineTool } from "eve/tools";
import { z } from "zod";
import { snapshot, withPage } from "../lib/chrome";

export default defineTool({
  description:
    "Open a URL in the real Chrome window on the user's machine (the window opens automatically if it is not already open) and return a compact snapshot of the page: visible text and interactive elements with refs like e1, e2. The user can sign in or solve a CAPTCHA in this same window.",
  inputSchema: z.object({ url: z.string().url() }),
  async execute({ url }) {
    return withPage(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      return snapshot(page);
    });
  },
});

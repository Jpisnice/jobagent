import { defineTool } from "eve/tools";
import { z } from "zod";
import { snapshot, withPage } from "../lib/chrome";

export default defineTool({
  description: "Press a key in the current Chrome tab (for example Enter, Tab, Escape) and return the new page snapshot.",
  inputSchema: z.object({ key: z.string().describe("Key name such as Enter, Tab or Escape") }),
  async execute({ key }) {
    return withPage(async (page) => {
      await page.keyboard.press(key);
      await page.waitForTimeout(600);
      return snapshot(page);
    });
  },
});

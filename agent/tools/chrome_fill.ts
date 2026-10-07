import { defineTool } from "eve/tools";
import { z } from "zod";
import { describe, refSelector, withPage } from "../lib/chrome";

export default defineTool({
  description:
    "Fill a form field by ref: types text into inputs and textareas, picks an option in a select (by visible label), and checks or unchecks a checkbox when text is \"true\" or \"false\". Never fills password fields; the user types those themselves in the Chrome window.",
  inputSchema: z.object({
    ref: z.string().describe("Element ref such as e7"),
    text: z.string().describe("Value to enter or option label to select"),
  }),
  async execute({ ref, text }) {
    return withPage(async (page) => {
      const el = await describe(page, ref);
      if (el.type === "password") {
        return { filled: false, reason: "Password fields are never filled by the agent. Ask the user to type it in Chrome." };
      }
      const loc = page.locator(refSelector(ref)).first();
      if (el.tag === "select") await loc.selectOption({ label: text }, { timeout: 8_000 });
      else if (el.type === "checkbox" || el.type === "radio") await loc.setChecked(text !== "false", { timeout: 8_000 });
      else await loc.fill(text, { timeout: 8_000 });
      return { filled: true, ref, field: el.label };
    });
  },
});

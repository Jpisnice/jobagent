import { defineTool } from "eve/tools";
import { z } from "zod";
import { snapshot, withPage } from "../lib/chrome";

export default defineTool({
  description:
    "Re-read the current Chrome tab: visible text and interactive elements with refs (e1, e2, ...). Refs are only valid until the next snapshot or page change, so call this again after clicking or navigating. Use it after the user says they have signed in.",
  inputSchema: z.object({}),
  async execute() {
    return withPage((page) => snapshot(page));
  },
});

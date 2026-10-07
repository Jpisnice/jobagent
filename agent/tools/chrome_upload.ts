import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { refSelector, withPage } from "../lib/chrome";

const DATA_DIR = resolve("data");

export default defineTool({
  description:
    "Attach a file from the project's data/ folder (for example the resume) to a file input by ref. Only files inside data/ can be uploaded.",
  inputSchema: z.object({
    ref: z.string().describe("Element ref of the file input or its upload button"),
    file: z.string().describe("File name inside data/, for example resume.pdf"),
  }),
  async execute({ ref, file }) {
    const full = resolve(DATA_DIR, file);
    if (relative(DATA_DIR, full).startsWith("..") || !existsSync(full)) {
      return { uploaded: false, reason: `File must exist inside data/. Not found: ${file}` };
    }
    return withPage(async (page) => {
      await page.locator(refSelector(ref)).first().setInputFiles(full, { timeout: 10_000 });
      return { uploaded: true, file };
    });
  },
});

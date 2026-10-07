import { defineTool } from "eve/tools";
import { z } from "zod";
import { readResume } from "../lib/resume";

export default defineTool({
  description:
    "Read the text of a resume file the user put in the project's data/ folder (PDF, DOCX or TXT). Use it during profile onboarding when the user names a file instead of pasting the resume text. Returns the plain text; build the profile from it only, never from guesses.",
  inputSchema: z.object({
    file: z.string().min(1).describe("File name inside data/, for example resume.pdf"),
  }),
  label: { start: ({ file }) => `Read resume ${file}` },
  async execute({ file }) {
    return readResume(file);
  },
});

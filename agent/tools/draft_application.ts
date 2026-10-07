import { defineTool } from "eve/tools";
import { z } from "zod";
import { profile } from "../lib/profile";

export default defineTool({
  description:
    "Return the profile facts and standard answers to use when drafting a cover letter / form answers for one job. Compose the draft yourself from these facts only; never invent experience.",
  inputSchema: z.object({ title: z.string(), company: z.string(), description: z.string().optional() }),
  async execute(input) {
    return {
      job: input,
      candidate: profile,
      guidance: "Write a short tailored cover letter and answers to likely form questions using only the facts above.",
    };
  },
});

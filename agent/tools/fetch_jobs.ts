import { defineTool } from "eve/tools";
import { z } from "zod";
import { sourceIds } from "../lib/sources";
import { ats, searchJobs } from "../lib/search";

export default defineTool({
  description:
    "Browse new job postings from many public sources (remote boards plus Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee for a built-in company list), filtered by keywords and excluding jobs already in the store. Nothing is reviewed or recorded; use screen_jobs to search AND fit-check in one go. Returns jobs balanced across sources and a per-source report.",
  inputSchema: z.object({
    keywords: z
      .array(z.string())
      .default([])
      .describe("Keep jobs whose title or description contains any of these (case-insensitive, whole word)"),
    sources: z
      .array(z.string())
      .optional()
      .describe(`Limit to some sources. Available: ${sourceIds.join(", ")}. Omit to search all.`),
    extraCompanies: z
      .array(z.object({ source: z.enum(ats), slug: z.string() }))
      .default([])
      .describe("Extra company slugs to search on top of the built-in list"),
    perSource: z.number().int().min(1).max(20).default(6).describe("Max jobs returned per source"),
    limit: z.number().int().min(1).max(50).default(30).describe("Max jobs returned in total"),
  }),
  label: {
    start: ({ keywords }) => (keywords.length ? `Search jobs: ${keywords.slice(0, 4).join(", ")}` : "Search jobs"),
  },
  async execute(input) {
    return searchJobs(input);
  },
  // The model only needs the gist of each posting; full descriptions stay on the event stream.
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        ...output,
        jobs: output.jobs.map((j) => ({ ...j, description: j.description?.slice(0, 200) })),
      },
    };
  },
});

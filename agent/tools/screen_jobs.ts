import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { requireProfile } from "../lib/profile";
import { searchJobs, type SourceStat } from "../lib/search";
import { batches, matcherMessage, mergeVerdicts, slimProfile, VerdictsSchema, type Screened } from "../lib/screening";
import type { Job } from "../lib/sources";
import { upsertJobs } from "../lib/store";

const BATCH = 10;

interface Output {
  phase: string;
  reviewed?: number;
  relevantCount?: number;
  skipped?: number;
  relevant?: Array<Omit<Job, "source"> & { score: number; reason: string }>;
  sourceErrors?: Record<string, string[]>;
  failedBatches?: string[];
  next?: string;
}

// Searches (or takes the given postings), has the matcher review them in parallel batches, records
// every verdict, and returns only the relevant jobs, so rejected postings never reach the main model.
export default defineWorkflowTool({
  description:
    "Find new jobs and fit-check them in one go. Searches every public source with the profile's keywords (or the keywords you pass), sends the postings to the matcher reviewer, records every verdict in the store (skipped or seen with a score), and returns only the relevant jobs with score and reason. Pass `jobs` instead to review specific postings, for example ones the user pasted.",
  inputSchema: z.object({
    keywords: z.array(z.string()).optional().describe("Override the profile's search keywords"),
    jobs: z
      .array(
        z.object({
          title: z.string(),
          company: z.string(),
          location: z.string().default(""),
          url: z.string().url(),
          description: z.string().optional(),
        }),
      )
      .max(30)
      .optional()
      .describe("Review these postings instead of searching"),
    limit: z.number().int().min(1).max(50).default(30).describe("Max postings to review when searching"),
  }),
  label: {
    start: ({ jobs }) => (jobs?.length ? `Screen ${jobs.length} postings` : "Search and screen jobs"),
    delta: (_input, partial: Output) => partial.phase,
    complete: (_input, output: Output) => output.phase,
  },
  async *execute(input, ctx): AsyncGenerator<Output> {
    "use workflow";
    const profile = await loadProfile();

    let jobs: Job[];
    let sourceErrors: Record<string, string[]> | undefined;
    if (input.jobs?.length) {
      jobs = input.jobs.map((j) => ({ ...j, source: "manual" }));
    } else {
      yield { phase: "Searching job sources" };
      const found = await search(input.keywords ?? profile.keywords, input.limit);
      jobs = found.jobs;
      sourceErrors = found.errors;
    }
    if (jobs.length === 0) {
      return { phase: "No new postings found", reviewed: 0, relevantCount: 0, skipped: 0, relevant: [], sourceErrors };
    }

    const groups = batches(jobs, BATCH);
    yield { phase: `Reviewing ${jobs.length} postings in ${groups.length} batches` };

    const failedBatches: string[] = [];
    const results = await Promise.all(
      groups.map(async (group, i) => {
        const response = await ctx.agent("matcher").send(matcherMessage(profile.slim, group), {
          outputSchema: VerdictsSchema,
          signal: ctx.abortSignal,
        });
        const { data, status, error } = await response.result();
        if (status === "failed" || !data) {
          failedBatches.push(`batch ${i + 1}: ${error?.message ?? "no verdicts returned"}`);
          return [] as Screened[];
        }
        return mergeVerdicts(group, data.verdicts, profile.minScore);
      }),
    );
    const screened = results.flat();

    // Jobs in a failed batch are not recorded, so the next search offers them again.
    await record(screened);

    const relevant = screened
      .filter((s) => s.relevant)
      .sort((a, b) => b.score - a.score)
      .map(({ job, score, reason }) => ({
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        description: job.description?.slice(0, 400),
        score,
        reason,
      }));
    return {
      phase: `${relevant.length} of ${screened.length} postings are a fit`,
      reviewed: screened.length,
      relevantCount: relevant.length,
      skipped: screened.length - relevant.length,
      relevant,
      ...(sourceErrors ? { sourceErrors } : {}),
      ...(failedBatches.length ? { failedBatches } : {}),
      next: relevant.length
        ? "Draft applications for these with draft_application, then send one send_alert digest."
        : "Nothing relevant; send no alert.",
    };
  },
});

async function loadProfile() {
  "use step";
  const p = await requireProfile();
  return { slim: slimProfile(p), keywords: p.preferences.keywords, minScore: p.preferences.minScore };
}

async function search(keywords: string[], limit: number) {
  "use step";
  const r = await searchJobs({ keywords, extraCompanies: [], perSource: 6, limit });
  const errors = Object.fromEntries(
    Object.entries(r.sourceStats as Record<string, SourceStat>)
      .filter(([, s]) => s.errors?.length)
      .map(([id, s]) => [id, s.errors!]),
  );
  return { jobs: r.jobs, errors: Object.keys(errors).length ? errors : undefined };
}

async function record(screened: Screened[]) {
  "use step";
  await upsertJobs(
    screened.map(({ job, relevant, score, reason }) => ({
      url: job.url,
      title: job.title,
      company: job.company,
      score,
      status: relevant ? ("seen" as const) : ("skipped" as const),
      note: reason,
    })),
  );
}

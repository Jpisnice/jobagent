import { z } from "zod";
import type { Profile } from "./profile";
import type { Job } from "./sources";

// Pure on purpose: screen_jobs runs these in its workflow body, which cannot import Node.js builtins.

// The same posting with a #fragment or trailing slash is the same job (the store's jobId hashes this).
export const urlKey = (url: string) => url.split("#")[0]!.replace(/\/$/, "");

// What the matcher returns for one batch, as structured output.
export const VerdictsSchema = z.object({
  verdicts: z.array(
    z.object({
      url: z.string(),
      relevant: z.boolean(),
      score: z.number().min(0).max(100),
      reason: z.string(),
    }),
  ),
});
export type Verdict = z.infer<typeof VerdictsSchema>["verdicts"][number];

export interface Screened {
  job: Job;
  relevant: boolean;
  score: number;
  reason: string;
}

// Just what a fit check needs: no contact details or full resume.
export const slimProfile = (profile: Profile) => ({
  headline: profile.headline,
  skills: profile.skills,
  experience: profile.experience.map((e) => `${e.title} @ ${e.company} (${e.start} to ${e.end ?? "present"})`),
  projects: profile.projects.map((p) => `${p.name}: ${p.tech.join(", ")}`),
  preferences: profile.preferences,
});

export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// One self-contained message per batch, so the matcher answers in a single step without tools.
export const matcherMessage = (profile: ReturnType<typeof slimProfile>, jobs: Job[]) =>
  [
    "Candidate profile:",
    JSON.stringify(profile),
    "",
    `Postings (${jobs.length}), return one verdict per posting with its url:`,
    JSON.stringify(
      jobs.map((j) => ({ title: j.title, company: j.company, location: j.location, url: j.url, description: j.description ?? "" })),
    ),
  ].join("\n");

// Pairs verdicts with their jobs by url. A job the matcher skipped counts as not relevant, and a
// relevant verdict below the candidate's minScore is demoted, so the gate does not rely on the model.
export function mergeVerdicts(jobs: Job[], verdicts: Verdict[], minScore: number): Screened[] {
  const byUrl = new Map(verdicts.map((v) => [urlKey(v.url), v]));
  return jobs.map((job) => {
    const v = byUrl.get(urlKey(job.url));
    if (!v) return { job, relevant: false, score: 0, reason: "No verdict from the matcher" };
    return { job, relevant: v.relevant && v.score >= minScore, score: v.score, reason: v.reason };
  });
}

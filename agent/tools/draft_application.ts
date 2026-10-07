import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireProfile, type Profile } from "../lib/profile";

// What a cover letter or form answers can draw on; contact details stay with get_profile.
const draftingView = (p: Profile) => ({
  name: p.name,
  headline: p.headline,
  summary: p.summary,
  strengths: p.strengths,
  skills: p.skills,
  experience: p.experience.map((e) => ({
    role: `${e.title} @ ${e.company} (${e.start} to ${e.end ?? "present"})`,
    highlights: e.highlights,
  })),
  projects: p.projects.map((pr) => ({ name: pr.name, tech: pr.tech, metrics: pr.metrics, highlights: pr.highlights })),
  education: p.education.map((e) => `${e.degree}, ${e.institution}${e.end ? ` (${e.end})` : ""}`),
  certifications: p.certifications.map((c) => c.name),
  answers: p.answers,
});

export default defineTool({
  description:
    "Return the candidate facts and standard answers to draft cover letters / form answers from. Pass every job you are drafting for in one call; the facts come back once. Compose each draft yourself from these facts only; never invent experience.",
  inputSchema: z.object({
    jobs: z
      .array(
        z.object({
          title: z.string(),
          company: z.string(),
          url: z.string().optional(),
          description: z.string().optional(),
        }),
      )
      .min(1)
      .max(10),
  }),
  label: {
    start: ({ jobs }) => (jobs.length === 1 ? `Draft for ${jobs[0]!.company}` : `Draft ${jobs.length} applications`),
  },
  async execute({ jobs }) {
    return {
      jobs,
      candidate: draftingView(await requireProfile()),
      guidance:
        "For each job write a short tailored cover letter (under 150 words) and answers to likely form questions, using only the facts above.",
    };
  },
});

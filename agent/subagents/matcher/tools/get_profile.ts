import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireProfile } from "../../../lib/profile";

// Slim view of the profile: just what a fit check needs, not the full resume.
export default defineTool({
  description: "Return the candidate's skills, experience level and job preferences for fit checks.",
  inputSchema: z.object({}),
  async execute() {
    const profile = await requireProfile();
    return {
      headline: profile.headline,
      skills: profile.skills,
      experience: profile.experience.map((e) => `${e.title} @ ${e.company} (${e.start} to ${e.end ?? "present"})`),
      projects: profile.projects.map((p) => `${p.name}: ${p.tech.join(", ")}`),
      preferences: profile.preferences,
    };
  },
});

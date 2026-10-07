import { defineTool } from "eve/tools";
import { z } from "zod";
import { assess, readProfile, type Profile } from "../lib/profile";

export const snapshot = (p: Profile) => ({
  name: p.name,
  headline: p.headline,
  location: p.contact.location,
  seniority: p.preferences.seniority,
  targetRoles: p.preferences.targetRoles,
  locationRules: Object.keys(p.preferences.locations),
  skillGroups: Object.keys(p.skills),
  experienceEntries: p.experience.length,
  projects: p.projects.length,
});

export default defineTool({
  description:
    "Check whether the candidate's job profile exists and is complete. Call this FIRST in any session that will search for jobs or apply. Returns exists, complete, the list of missing items (each with a question to ask the user) and optional items worth asking once. If the profile is missing or incomplete, run profile onboarding before anything else.",
  inputSchema: z.object({}),
  label: { start: () => "Check profile" },
  async execute() {
    const r = await readProfile();
    if (r.state === "missing") {
      return {
        exists: false,
        valid: true,
        complete: false,
        missing: [],
        optional: [],
        next: "No profile yet. Ask the user to paste their resume text, or to copy a PDF/DOCX/TXT into data/ and tell you the file name. Then read it (read_resume for a file), extract the profile and save it with save_profile.",
      };
    }
    if (r.state === "invalid") {
      return {
        exists: true,
        valid: false,
        complete: false,
        problems: r.problems,
        next: "The saved profile file is damaged. Tell the user, then rebuild it with save_profile (or ask for the resume again).",
      };
    }
    const { complete, missing, optional } = assess(r.profile);
    return {
      exists: true,
      valid: true,
      complete,
      missing,
      optional,
      snapshot: snapshot(r.profile),
      next: complete
        ? "The profile is complete. Continue with the job search."
        : "Ask the user ALL the missing items together in one message (numbered), save their answers with save_profile, then call profile_status again.",
    };
  },
});

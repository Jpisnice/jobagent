import { defineTool } from "eve/tools";
import { ZodError } from "zod";
import { assess, mergeProfile, PatchSchema, readProfile, writeProfile } from "../lib/profile";
import { snapshot } from "./profile_status";

export default defineTool({
  description:
    "Create or update the candidate's job profile. Send only what you have just learned (from the resume text or from the user's answers); everything else is kept. Scalars overwrite, contact and preferences merge field by field, skill groups, location rules and answers merge by name, and lists such as experience, projects and education are replaced when you send them. Use only facts the user gave or the resume states; never invent details. Returns what is still missing.",
  inputSchema: PatchSchema,
  async execute(patch) {
    // A missing or damaged file is started fresh instead of merged into.
    const current = await readProfile();
    let merged;
    try {
      merged = mergeProfile(current.state === "ok" ? current.profile : null, patch);
    } catch (e) {
      if (e instanceof Error && "issues" in e) {
        const issues = (e as ZodError).issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        throw new Error(`The profile was not saved. Fix and resend: ${issues.join("; ")}`);
      }
      throw e;
    }
    await writeProfile(merged);
    const { complete, missing, optional } = assess(merged);
    return {
      saved: true,
      created: current.state !== "ok",
      complete,
      missing,
      optional,
      snapshot: snapshot(merged),
      next: complete
        ? "The profile is complete. Show the user a short summary and ask them to confirm or correct it."
        : "Ask the user ALL the missing items together in one message (numbered), then save their answers.",
    };
  },
});

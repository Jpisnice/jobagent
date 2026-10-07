import { defineTool } from "eve/tools";
import { z } from "zod";
import { requireProfile } from "../lib/profile";

export default defineTool({
  description:
    "Return the candidate's job profile: contact details, skills, experience, projects, education, target roles, location rules, dealbreakers, minScore and standard answers. Fails with instructions if there is no profile yet; run profile onboarding then.",
  inputSchema: z.object({}),
  async execute() {
    return requireProfile();
  },
});

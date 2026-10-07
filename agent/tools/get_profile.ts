import { defineTool } from "eve/tools";
import { z } from "zod";
import { profile } from "../lib/profile";

export default defineTool({
  description: "Return the candidate's job profile: resume, target roles, locations, salary floor, dealbreakers, minScore and standard answers.",
  inputSchema: z.object({}),
  async execute() {
    return profile;
  },
});

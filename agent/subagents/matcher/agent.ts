import { defineAgent } from "eve";
import { gemini } from "../../lib/model";

export default defineAgent({
  description:
    "Quick job-fit check. Send up to 10 postings (title, company, location, url, short description); it returns a one-line verdict per posting: relevant or not, a score, and a short reason. Send jobs here before drafting or alerting.",
  model: gemini(process.env.GEMINI_MATCHER_MODEL ?? "gemini-3.1-flash-lite"),
  // Keep it a simple verdict: minimal thinking and hard caps so it cannot run on.
  reasoning: "minimal",
  limits: {
    maxInputTokensPerSession: 40_000,
    maxOutputTokensPerSession: 3_000,
  },
});

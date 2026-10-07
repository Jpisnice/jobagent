import { defineAgent } from "eve";
import { gemini } from "../../lib/model";

export default defineAgent({
  description:
    "Quick job-fit check. Gets the candidate profile and up to 10 postings in one message and returns a structured verdict per posting: relevant or not, a score, and a short reason.",
  model: gemini(process.env.GEMINI_MATCHER_MODEL ?? "gemini-3.1-flash-lite"),
  // Reached only through the screen_jobs workflow tool, which sends batches and records the verdicts.
  tool: false,
  // It needs no tools: everything it judges is in the message, so each batch is one model call.
  defaultTools: false,
  // Keep it a simple verdict: minimal thinking and hard caps so it cannot run on.
  reasoning: "minimal",
  limits: {
    maxInputTokensPerSession: 20_000,
    maxOutputTokensPerSession: 3_000,
  },
});

import { defineAgent } from "eve";
import { gemini } from "./lib/model";

// eve can't look up the context window of a model wired in directly, so without
// this it never compacts and eventually overflows. The window is set well below
// Gemini's real limit on purpose: it keeps every step cheap and compacts early.
const CONTEXT_WINDOW = 200_000;

export default defineAgent({
  model: gemini(process.env.GEMINI_MODEL ?? "gemini-3-flash-preview"),
  modelContextWindowTokens: CONTEXT_WINDOW,
  compaction: {
    thresholdPercent: 0.6,
    modelContextWindowTokens: CONTEXT_WINDOW,
  },
  // playwright-core reads its own package.json at runtime, so it can't be bundled.
  build: { externalDependencies: ["playwright-core"] },
  // Per-session safety caps, counted across all model calls in the session.
  limits: {
    maxInputTokensPerSession: 3_000_000,
    maxOutputTokensPerSession: 100_000,
  },
});

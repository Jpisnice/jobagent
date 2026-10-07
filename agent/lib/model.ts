import { createGoogleGenerativeAI } from "@ai-sdk/google";

// Calls Gemini directly with your own key instead of the Vercel AI Gateway.
const google = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export const gemini = (id: string) => google(id);

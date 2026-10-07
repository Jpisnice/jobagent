import { disableTool } from "eve/tools";

// Gemini can't combine its provider-managed search with function tools, so the
// built-in web_search is turned off. fetch_jobs and the Browserbase tools find jobs.
export default disableTool();

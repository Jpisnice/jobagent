import { defineSchedule } from "eve/schedules";

// Cron runs in UTC on Vercel. Schedule sessions cannot receive approvals or answer questions, so this
// only discovers, reviews, drafts and emails; onboarding and applying happen in a chat session.
export default defineSchedule({
  cron: "0 8 * * *",
  markdown:
    "Run the daily job search. First call profile_status. If the profile is missing or incomplete, send one short send_alert email asking the user to open a chat and finish profile onboarding, then stop. Otherwise call screen_jobs (it searches, has the matcher review fit and records every verdict). If it returns relevant jobs, call draft_application once with all of them and send ONE send_alert digest listing them. Do NOT submit any application. If nothing is relevant, send nothing.",
});

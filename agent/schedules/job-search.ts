import { defineSchedule } from "eve/schedules";

// Cron runs in UTC on Vercel. Schedule sessions cannot receive approvals, so this
// only discovers, reviews, drafts and emails; applying happens in a later session.
export default defineSchedule({
  cron: "0 8 * * *",
  markdown:
    "Run the daily job search: get_profile, fetch_jobs with the profile keywords, send the new postings to the matcher subagent for a fit review, record_job every reviewed job (skipped for not relevant), then draft_application and send_alert one digest for only the jobs the matcher marked relevant. Do NOT submit any application. If nothing is relevant, send nothing.",
});

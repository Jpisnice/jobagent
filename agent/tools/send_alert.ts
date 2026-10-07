import { defineTool } from "eve/tools";
import { z } from "zod";
import { alertEmail } from "../lib/profile";
import { upsertJob } from "../lib/store";

export default defineTool({
  description: "Email the candidate an alert or digest of matched jobs (HTML or plain text) and mark the listed jobs as notified.",
  inputSchema: z.object({
    subject: z.string(),
    body: z.string().describe("Plain text or HTML body"),
    jobs: z.array(z.object({ url: z.string().url(), title: z.string(), company: z.string(), score: z.number() })).default([]),
  }),
  async execute({ subject, body, jobs }) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.ALERT_FROM_EMAIL;
    if (!key || !from) throw new Error("Set RESEND_API_KEY and ALERT_FROM_EMAIL");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [alertEmail()], subject, html: body.includes("<") ? body : `<pre>${body}</pre>` }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    for (const j of jobs) await upsertJob({ ...j, status: "notified" });
    return { sent: true, notified: jobs.length };
  },
});

import { readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { runTask } from "../lib/browser";
import { requireProfile } from "../lib/profile";

// The report the browser service returns for an inspect run (FormReport in browser-service/server.py).
// Lenient on purpose: a field the model left out should not throw the whole report away.
const FormReport = z.object({
  title: z.string().catch(""),
  company: z.string().catch(""),
  url: z.string().catch(""),
  fields: z
    .array(
      z.object({
        label: z.string(),
        type: z.string().catch("other"),
        required: z.boolean().catch(false),
        options: z.array(z.string()).catch([]),
        section: z.string().catch(""),
      }),
    )
    .catch([]),
  more_steps: z.boolean().catch(false),
  notes: z.string().catch(""),
});

export function parseReport(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = FormReport.safeParse(JSON.parse(raw));
    return parsed.success && parsed.data.fields.length > 0 ? parsed.data : null;
  } catch {
    return null;
  }
}

// Files in data/ that could be uploaded as a resume or cover letter.
async function uploadable(): Promise<string[]> {
  try {
    const names = await readdir(resolve(process.env.DATA_DIR ?? "data"));
    return names.filter((n) => [".pdf", ".docx", ".doc"].includes(extname(n).toLowerCase()));
  } catch {
    return [];
  }
}

export default defineTool({
  description:
    "Open a job application link the user pasted in their Chrome window and read the application form WITHOUT filling anything: every field's label, type, whether it is required and its options. Returns the fields together with the candidate profile and the files in data/ that can be uploaded, so you can work out which answers the profile gives and which you must ask the user. Use it first whenever the user pastes a link to apply to.",
  inputSchema: z.object({
    url: z.string().url().describe("The job posting or application form link"),
  }),
  label: {
    start: () => "Reading the application form",
    complete: (_input, output) => {
      const o = output as { fields?: unknown[]; status: string };
      return o.fields ? `Read ${o.fields.length} form fields` : `Form: ${o.status}`;
    },
  },
  async execute({ url }, ctx) {
    // Fails with onboarding instructions before the browser is touched.
    const profile = await requireProfile();
    const r = await runTask(
      { task: `Open ${url} and read the job application form.`, maxSteps: 30, key: ctx.callId, mode: "inspect" },
      ctx.abortSignal,
      8 * 60_000,
    );

    if (r.status === "needs_human") {
      return {
        status: r.status,
        reason: r.reason,
        next: "Use ask_question to tell the user what to do in the Chrome window, wait for their answer, then call inspect_application again with the same url.",
      };
    }
    const form = r.status === "done" ? parseReport(r.result) : null;
    if (!form) {
      return {
        status: "failed",
        reason: r.reason ?? "The form could not be read.",
        result: r.result?.slice(0, 2000) ?? null,
        next: "Tell the user the form could not be read. If they still want to apply, ask for the answers you need and use browser_task, which reports any field it could not fill.",
      };
    }

    return {
      status: "done",
      job: { url, formUrl: form.url || url, title: form.title, company: form.company },
      fields: form.fields,
      moreSteps: form.more_steps,
      notes: form.notes,
      profile,
      files: await uploadable(),
      next:
        "Map every field to an answer from the profile (contact details, links, experience, education, skills, answers such as noticePeriod and workAuthorization). " +
        "Do not ask about anything the profile answers or that is plainly derivable from it. Then ask the user, in ONE numbered ask_question, for every required field you cannot answer " +
        "and every optional question where a guess could hurt them (salary expectations, start date, sponsorship, relocation, demographic and disability questions, which they may decline). " +
        "Save answers that will recur on other applications with save_profile answers. Follow the apply-in-browser skill for the rest.",
    };
  },
});

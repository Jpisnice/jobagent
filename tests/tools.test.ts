import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshStore, jsonResponse, parseInput, stubFetch, textResponse, toolCtx } from "./helpers";

const runTask = vi.hoisted(() => vi.fn());
vi.mock("../agent/lib/browser", () => ({ runTask }));

let ctx: Awaited<ReturnType<typeof freshStore>>;
beforeEach(async () => {
  ctx = await freshStore();
  runTask.mockReset();
});
afterEach(() => ctx.cleanup());

const load = async (name: string) => (await import(`../agent/tools/${name}.ts`)).default as any;
const call = (tool: any, input: unknown, id = "call-1") => tool.execute(parseInput(tool, input), toolCtx(id));
// `approval: always()` is a policy function; calling it must ask the user, whatever the input.
async function expectAlwaysAsksUser(tool: any) {
  expect(typeof tool.approval).toBe("function");
  const decision = await tool.approval({ toolName: tool.name ?? "t", toolInput: {}, approvedTools: [], callId: "c", abortSignal: new AbortController().signal, session: {} });
  expect(decision).toBe("user-approval");
}
const jobInput = { url: "https://jobs.example.com/1", title: "Engineer", company: "Acme" };

describe("get_profile", () => {
  it("returns the whole profile", async () => {
    const out = await call(await load("get_profile"), {});
    expect(out.name).toBe("Janardhan Polle");
    expect(out.skills.languages).toContain("TypeScript");
    expect(out.preferences.minScore).toBeGreaterThan(0);
  });
});

describe("matcher's get_profile", () => {
  it("returns a slim view without the resume text, contact details or answers", async () => {
    const tool = (await import("../agent/subagents/matcher/tools/get_profile")).default as any;
    const out = await call(tool, {});
    expect(Object.keys(out).sort()).toEqual(["experience", "headline", "preferences", "projects", "skills"]);
    const text = JSON.stringify(out);
    expect(text).not.toContain("@gmail.com");
    expect(text).not.toContain("84598");
    expect(out.experience[0]).toMatch(/Isymply/);
    expect(out.experience[0]).toMatch(/present/);
  });
});

describe("draft_application", () => {
  it("returns the job plus candidate facts and tells the model not to invent anything", async () => {
    const out = await call(await load("draft_application"), { title: "Engineer", company: "Acme" });
    expect(out.job).toMatchObject({ title: "Engineer", company: "Acme" });
    expect(out.candidate.name).toBe("Janardhan Polle");
    expect(out.guidance).toMatch(/only/i);
  });
});

describe("record_job", () => {
  it("saves the job in the store", async () => {
    const out = await call(await load("record_job"), { ...jobInput, status: "skipped", note: "Java stack", score: 20 });
    expect(out).toMatchObject({ status: "skipped", note: "Java stack", score: 20 });
    expect(Object.keys(await ctx.store.getJobs())).toHaveLength(1);
  });

  it("rejects an invalid status or score", async () => {
    const tool = await load("record_job");
    expect(() => parseInput(tool, { ...jobInput, status: "maybe" })).toThrow();
    expect(() => parseInput(tool, { ...jobInput, status: "seen", score: 101 })).toThrow();
    expect(() => parseInput(tool, { ...jobInput, url: "not a url", status: "seen" })).toThrow();
  });

  it("handles a burst of parallel calls without losing any", async () => {
    const tool = await load("record_job");
    await Promise.all(
      Array.from({ length: 15 }, (_, i) => call(tool, { ...jobInput, url: `https://jobs.example.com/${i}`, status: "skipped" })),
    );
    expect(Object.keys(await ctx.store.getJobs())).toHaveLength(15);
  });
});

describe("approve_application", () => {
  it("always requires approval", async () => {
    const tool = await load("approve_application");
    await expectAlwaysAsksUser(tool);
  });

  it("marks the job approved and points to the next step", async () => {
    const out = await call(await load("approve_application"), { ...jobInput, draft: "Dear team..." });
    expect(out.approved).toBe(true);
    expect(Object.values(await ctx.store.getJobs())[0]!.status).toBe("approved");
  });
});

describe("send_alert", () => {
  const body = { subject: "3 new jobs", body: "Line one\nLine two", jobs: [{ ...jobInput, score: 91 }] };

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("ALERT_FROM_EMAIL", "alerts@example.com");
    vi.stubEnv("ALERT_TO_EMAIL", "me@example.com");
  });

  it("sends through Resend with the right fields and marks the jobs notified", async () => {
    const { calls } = stubFetch({ "api.resend.com/emails": { id: "em_1" } });
    const out = await call(await load("send_alert"), body);
    expect(out).toEqual({ sent: true, notified: 1 });
    const req = calls[0]!;
    expect((req.init!.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    expect(JSON.parse(req.init!.body as string)).toMatchObject({
      from: "alerts@example.com", to: ["me@example.com"], subject: "3 new jobs",
    });
    const [rec] = Object.values(await ctx.store.getJobs());
    expect(rec).toMatchObject({ status: "notified", score: 91 });
  });

  it("wraps plain text in <pre> and leaves html alone", async () => {
    const { calls } = stubFetch({ "api.resend.com": { id: "x" } });
    const tool = await load("send_alert");
    await call(tool, { subject: "s", body: "plain text" });
    await call(tool, { subject: "s", body: "<h1>Hi</h1>" });
    expect(JSON.parse(calls[0]!.init!.body as string).html).toBe("<pre>plain text</pre>");
    expect(JSON.parse(calls[1]!.init!.body as string).html).toBe("<h1>Hi</h1>");
  });

  it("falls back to the resume email when ALERT_TO_EMAIL is not set", async () => {
    vi.stubEnv("ALERT_TO_EMAIL", "");
    delete process.env.ALERT_TO_EMAIL;
    const { calls } = stubFetch({ "api.resend.com": { id: "x" } });
    await call(await load("send_alert"), { subject: "s", body: "b" });
    expect(JSON.parse(calls[0]!.init!.body as string).to).toEqual(["janardhanpolle26@gmail.com"]);
  });

  it("fails clearly without Resend settings and sends nothing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { calls } = stubFetch({});
    await expect(call(await load("send_alert"), body)).rejects.toThrow(/RESEND_API_KEY/);
    expect(calls).toHaveLength(0);
  });

  it("does not mark jobs notified when Resend rejects the email", async () => {
    stubFetch({ "api.resend.com": textResponse("domain not verified", 403) });
    await expect(call(await load("send_alert"), body)).rejects.toThrow(/Resend 403.*domain not verified/);
    expect(await ctx.store.getJobs()).toEqual({});
  });

  it("works with an empty job list", async () => {
    stubFetch({ "api.resend.com": jsonResponse({ id: "x" }) });
    expect(await call(await load("send_alert"), { subject: "s", body: "b" })).toEqual({ sent: true, notified: 0 });
  });
});

describe("browser_task", () => {
  const input = { task: "Open https://jobs.example.com/1 and fill the form", files: ["resume.pdf"], maxSteps: 40 };

  it("passes the task, files, step budget and the call id as an idempotency key", async () => {
    runTask.mockResolvedValue({ status: "done", steps: 4, seconds: 9, result: "filled", reason: null });
    const tool = await load("browser_task");
    await call(tool, input, "call-xyz");
    expect(runTask).toHaveBeenCalledWith(
      { task: input.task, files: ["resume.pdf"], maxSteps: 40, key: "call-xyz" },
      expect.anything(),
    );
  });

  it("never allows submitting", async () => {
    runTask.mockResolvedValue({ status: "done", steps: 1, seconds: 1, result: "", reason: null });
    await call(await load("browser_task"), input);
    expect(runTask.mock.calls[0]![0].allowSubmit).toBeUndefined();
  });

  it.each([
    ["needs_human", /ask_question/],
    ["needs_submit_approval", /browser_submit/],
    ["done", /browser_submit/],
    ["failed", /failed/],
  ])("tells the model what to do next when the status is %s", async (status, hint) => {
    runTask.mockResolvedValue({ status, steps: 2, seconds: 3, result: "r", reason: "why" });
    const out = await call(await load("browser_task"), input);
    expect(out).toMatchObject({ status, result: "r", reason: "why" });
    expect(out.next).toMatch(hint);
  });

  it("validates its input", async () => {
    const tool = await load("browser_task");
    expect(() => parseInput(tool, { task: "too short" })).toThrow();
    expect(() => parseInput(tool, { ...input, maxSteps: 500 })).toThrow();
    expect(parseInput(tool, { task: input.task }) as any).toMatchObject({ files: [], maxSteps: 60 });
  });

  it("lets a service error reach the model", async () => {
    runTask.mockRejectedValue(new Error("run `npm run browser`"));
    await expect(call(await load("browser_task"), input)).rejects.toThrow(/npm run browser/);
  });
});

describe("browser_submit", () => {
  const input = { jobUrl: "https://jobs.example.com/1", summary: "Engineer at Acme, resume attached" };

  it("always requires approval", async () => {
    const tool = await load("browser_submit");
    await expectAlwaysAsksUser(tool);
  });

  it("is the only caller that turns allowSubmit on, with a small step budget", async () => {
    runTask.mockResolvedValue({ status: "done", steps: 2, seconds: 5, result: "Thank you!", reason: null });
    const out = await call(await load("browser_submit"), input, "call-submit");
    const [body, , timeout] = runTask.mock.calls[0]!;
    expect(body).toMatchObject({ allowSubmit: true, maxSteps: 10, key: "call-submit" });
    expect(body.task).toContain(input.summary);
    expect(body.task).toMatch(/do not change any field/i);
    expect(timeout).toBeLessThanOrEqual(5 * 60_000);
    expect(out).toMatchObject({ status: "done", confirmation: "Thank you!" });
    expect(out.next).toMatch(/applied/);
  });

  it("reports a failure so the job can be recorded as failed", async () => {
    runTask.mockResolvedValue({ status: "failed", steps: 3, seconds: 8, result: null, reason: "button not found" });
    const out = await call(await load("browser_submit"), input);
    expect(out).toMatchObject({ status: "failed", reason: "button not found" });
    expect(out.next).toMatch(/failed/);
  });
});

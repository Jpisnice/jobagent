import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeDocx, sampleProfile, sampleResumeLines, useProfile } from "./fixtures";
import { parseInput, toolCtx } from "./helpers";

let env: ReturnType<typeof useProfile>;
afterEach(() => env?.cleanup());

const modules: Record<string, () => Promise<{ default: unknown }>> = {
  "tools/profile_status": () => import("../agent/tools/profile_status"),
  "tools/read_resume": () => import("../agent/tools/read_resume"),
  "tools/save_profile": () => import("../agent/tools/save_profile"),
  "tools/get_profile": () => import("../agent/tools/get_profile"),
  "tools/draft_application": () => import("../agent/tools/draft_application"),
  "subagents/matcher/tools/get_profile": () => import("../agent/subagents/matcher/tools/get_profile"),
};
const load = async (path: string) => (await modules[path]!()).default as any;
const run = async (tool: any, input: unknown = {}) => tool.execute(parseInput(tool, input), toolCtx());

// What the model would send after reading the resume text in sampleResumeLines.
const fromResume = {
  name: "Test Candidate",
  headline: "Backend Engineer",
  summary: "Backend engineer who cut p99 latency by 40%.",
  contact: { email: "test.candidate@example.com", phone: "+1 555 010 0199", location: "Lisbon, Portugal" },
  skills: [{ group: "languages", items: ["Go", "Python"] }, { group: "backend", items: ["PostgreSQL", "gRPC", "Kafka"] }],
  experience: [
    { title: "Backend Engineer", company: "Initech", start: "2023-02", highlights: ["Cut p99 latency by 40%"] },
    { title: "Junior Developer", company: "Hooli", start: "2021-06", end: "2023-01", highlights: [] },
  ],
  education: [{ degree: "BSc Computer Science", institution: "Uni of Example", start: 2017, end: 2021 }],
};

describe("profile_status", () => {
  it("says there is no profile and how to start", async () => {
    env = useProfile(null);
    const r = await run(await load("tools/profile_status"));
    expect(r).toMatchObject({ exists: false, complete: false });
    expect(r.next).toMatch(/paste their resume/);
    expect(r.next).toMatch(/read_resume/);
    expect(r.next).toMatch(/save_profile/);
  });

  it("reports a complete profile with a snapshot and nothing missing", async () => {
    env = useProfile();
    const r = await run(await load("tools/profile_status"));
    expect(r).toMatchObject({ exists: true, valid: true, complete: true, missing: [] });
    expect(r.snapshot).toMatchObject({
      name: "Test Candidate", seniority: "mid", targetRoles: ["Backend Engineer", "Platform Engineer"],
      locationRules: ["Portugal", "EU"], experienceEntries: 2,
    });
    expect(r.next).toMatch(/Continue with the job search/);
  });

  it("lists what is missing, with a question for each, and tells the model to ask them together", async () => {
    env = useProfile({ name: "Half Done", contact: { email: "h@d.co" } });
    const r = await run(await load("tools/profile_status"));
    expect(r.complete).toBe(false);
    expect(r.missing.map((g: any) => g.field)).toContain("preferences.locations");
    expect(r.missing.every((g: any) => g.question.length > 10)).toBe(true);
    expect(r.next).toMatch(/ALL the missing items together/);
  });

  it("flags a damaged profile file instead of crashing", async () => {
    env = useProfile(null);
    writeFileSync(env.profilePath, "{ broken");
    const r = await run(await load("tools/profile_status"));
    expect(r).toMatchObject({ exists: true, valid: false, complete: false });
    expect(r.problems[0]).toMatch(/not valid JSON/);
    expect(r.next).toMatch(/damaged/);
  });

  it("does not leak the full profile, only a snapshot", async () => {
    env = useProfile();
    const text = JSON.stringify(await run(await load("tools/profile_status")));
    expect(text).not.toContain("555 010");
    expect(text).not.toContain("test.candidate@example.com");
  });
});

describe("read_resume tool", () => {
  beforeEach(() => {
    env = useProfile(null);
  });

  it("returns the text of a DOCX in data/", async () => {
    writeFileSync(join(env.dataDir, "me.docx"), await makeDocx(sampleResumeLines));
    const r = await run(await load("tools/read_resume"), { file: "me.docx" });
    expect(r.text).toContain("Backend Engineer, Initech");
  });

  it("passes the helpful errors through", async () => {
    await expect(run(await load("tools/read_resume"), { file: "missing.pdf" })).rejects.toThrow(/copy their resume/);
    await expect(run(await load("tools/read_resume"), { file: "../x.pdf" })).rejects.toThrow(/inside the data\/ folder/);
  });

  it("requires a file name", async () => {
    const tool = await load("tools/read_resume");
    expect(() => parseInput(tool, {})).toThrow();
    expect(() => parseInput(tool, { file: "" })).toThrow();
  });
});

describe("save_profile", () => {
  it("creates the profile from a resume and reports what is still missing", async () => {
    env = useProfile(null);
    const r = await run(await load("tools/save_profile"), fromResume);
    expect(r).toMatchObject({ saved: true, created: true, complete: false });
    expect(r.missing.map((g: any) => g.field)).toEqual([
      "preferences.seniority", "preferences.targetRoles", "preferences.keywords", "preferences.locations",
      "answers.noticePeriod", "answers.workAuthorization",
    ]);
    const onDisk = JSON.parse(readFileSync(env.profilePath, "utf8"));
    expect(onDisk.name).toBe("Test Candidate");
    expect(onDisk.experience[0]).toMatchObject({ end: null, current: true });
  });

  it("updates an existing profile without losing anything else", async () => {
    env = useProfile();
    const r = await run(await load("tools/save_profile"), { headline: "Platform Engineer" });
    expect(r).toMatchObject({ saved: true, created: false, complete: true });
    const onDisk = JSON.parse(readFileSync(env.profilePath, "utf8"));
    expect(onDisk.headline).toBe("Platform Engineer");
    expect(onDisk.experience).toHaveLength(2);
    expect(onDisk.preferences.locations.EU.required).toBe(true);
  });

  it("does not write anything when the data is invalid, and says what to fix", async () => {
    env = useProfile();
    const before = readFileSync(env.profilePath, "utf8");
    const tool = await load("tools/save_profile");
    await expect(run(tool, { experience: [{ title: "t", company: "c", start: "last year", highlights: [] }] })).rejects.toThrow(/not saved.*start/s);
    await expect(run(tool, { contact: { email: "nope" } })).rejects.toThrow(/not saved.*email/s);
    expect(readFileSync(env.profilePath, "utf8")).toBe(before);
  });

  it("starts fresh when the existing file is damaged", async () => {
    env = useProfile(null);
    writeFileSync(env.profilePath, "{ broken");
    const r = await run(await load("tools/save_profile"), { name: "Fresh Start" });
    expect(r).toMatchObject({ saved: true, created: true });
    expect(JSON.parse(readFileSync(env.profilePath, "utf8")).name).toBe("Fresh Start");
  });

  it("accepts an empty patch as a no-op", async () => {
    env = useProfile();
    expect(await run(await load("tools/save_profile"), {})).toMatchObject({ saved: true, complete: true });
  });
});

describe("tools that need a profile", () => {
  it.each([
    ["tools/get_profile", {}],
    ["tools/draft_application", { title: "Engineer", company: "Acme" }],
    ["subagents/matcher/tools/get_profile", {}],
  ])("%s tells the model to run onboarding when there is no profile", async (path, input) => {
    env = useProfile(null);
    await expect(run(await load(path), input)).rejects.toThrow(/profile_status/);
  });

  it("get_profile returns the saved profile", async () => {
    env = useProfile();
    expect(await run(await load("tools/get_profile"))).toMatchObject({ name: "Test Candidate", answers: { noticePeriod: "60 days" } });
  });

  it("draft_application passes the candidate through", async () => {
    env = useProfile();
    const out = await run(await load("tools/draft_application"), { title: "Engineer", company: "Acme" });
    expect(out.candidate.name).toBe("Test Candidate");
    expect(out.job).toMatchObject({ title: "Engineer", company: "Acme" });
  });

  it("the matcher's profile is a slim view with no contact details", async () => {
    env = useProfile();
    const out = await run(await load("subagents/matcher/tools/get_profile"));
    expect(Object.keys(out).sort()).toEqual(["experience", "headline", "preferences", "projects", "skills"]);
    expect(out.experience[0]).toBe("Backend Engineer @ Initech (2023-02 to present)");
    expect(JSON.stringify(out)).not.toMatch(/555 010|test\.candidate@/);
  });
});

describe("whole onboarding, the way the agent drives it", () => {
  it("empty -> resume -> questions -> complete -> usable by the other tools", async () => {
    env = useProfile(null);
    const status = await load("tools/profile_status");
    const save = await load("tools/save_profile");

    // 1. nothing yet
    expect((await run(status)).exists).toBe(false);

    // 2. user names a resume file; the agent reads it and saves what the resume says
    writeFileSync(join(env.dataDir, "resume.docx"), await makeDocx(sampleResumeLines));
    const resume = await run(await load("tools/read_resume"), { file: "resume.docx" });
    expect(resume.text).toContain("Initech");
    const afterResume = await run(save, fromResume);
    expect(afterResume.complete).toBe(false);

    // 3. status now asks only about preferences, never about things the resume already answered
    const gaps = (await run(status)).missing.map((g: any) => g.field);
    expect(gaps).toEqual(expect.arrayContaining(["preferences.locations", "answers.noticePeriod"]));
    expect(gaps).not.toContain("name");
    expect(gaps).not.toContain("skills");

    // 4. user answers; the agent saves the answers, deriving keywords itself
    const afterAnswers = await run(save, {
      preferences: {
        seniority: "mid",
        targetRoles: ["Backend Engineer"],
        keywords: ["Go", "PostgreSQL", "Kafka"],
        locations: [
          { name: "Portugal", workMode: ["hybrid", "remote"], preferred: "hybrid" },
          { name: "EU", regions: ["Germany", "Spain"], workMode: ["remote"], required: true, minSalaryINR: 2_500_000 },
        ],
      },
      answers: [{ key: "noticePeriod", value: "60 days" }, { key: "workAuthorization", value: "EU citizen" }],
    });
    expect(afterAnswers).toMatchObject({ complete: true, missing: [] });
    expect(afterAnswers.optional.map((g: any) => g.field)).toContain("preferences.dealbreakers");

    // 5. the optional question is answered later; completeness never regresses
    await run(save, { preferences: { dealbreakers: ["gambling"] } });
    expect((await run(status)).complete).toBe(true);

    // 6. the rest of the agent can now use it
    const profile = await run(await load("tools/get_profile"));
    expect(profile.preferences.locations.EU).toEqual({ regions: ["Germany", "Spain"], workMode: ["remote"], required: true, minSalaryINR: 2_500_000 });
    expect(profile.experience[0].current).toBe(true);
    expect(profile.answers).toEqual({ noticePeriod: "60 days", workAuthorization: "EU citizen" });
  });

  it("is safe to run again: a second pass with the same data changes nothing", async () => {
    env = useProfile(sampleProfile());
    const before = readFileSync(env.profilePath, "utf8");
    await run(await load("tools/save_profile"), { name: "Test Candidate" });
    expect(JSON.parse(readFileSync(env.profilePath, "utf8"))).toMatchObject(JSON.parse(before));
  });
});

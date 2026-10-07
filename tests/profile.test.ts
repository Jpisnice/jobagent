import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { alertEmail, assess, mergeProfile, NO_PROFILE, PatchSchema, ProfileSchema, readProfile, requireProfile, writeProfile } from "../agent/lib/profile";
import { sampleProfile, useProfile } from "./fixtures";

const parse = (over: Record<string, unknown> = {}) => ProfileSchema.parse(sampleProfile(over));
const empty = () => ProfileSchema.parse({});
const fields = (p: ReturnType<typeof empty>) => assess(p).missing.map((g) => g.field);

describe("ProfileSchema", () => {
  it("accepts an empty object and fills every default, so half-finished profiles can be saved", () => {
    const p = empty();
    expect(p).toMatchObject({ name: "", skills: {}, experience: [], answers: {} });
    expect(p.preferences).toMatchObject({ targetRoles: [], locations: {}, remoteOk: true, minScore: 70 });
  });

  it("keeps a complete profile as it is", () => {
    expect(parse().preferences.locations.EU).toMatchObject({ workMode: ["remote"], required: true });
  });

  it("only checks the email format when an email is given", () => {
    expect(ProfileSchema.safeParse({ contact: { email: "" } }).success).toBe(true);
    expect(ProfileSchema.safeParse({ contact: { email: "not-an-email" } }).success).toBe(false);
  });

  it.each(["2024-13", "24-01", "January 2024", "2024-1"])("rejects the date %s", (start) => {
    expect(ProfileSchema.safeParse({ experience: [{ title: "t", company: "c", start }] }).success).toBe(false);
  });

  it("rejects a minScore outside 0-100 and a salary floor that is not positive", () => {
    expect(ProfileSchema.safeParse({ preferences: { minScore: 120 } }).success).toBe(false);
    expect(ProfileSchema.safeParse({ preferences: { locations: { X: { workMode: ["remote"], minSalaryINR: -1 } } } }).success).toBe(false);
  });

  it("requires every location rule to name at least one work mode", () => {
    expect(ProfileSchema.safeParse({ preferences: { locations: { X: { workMode: [] } } } }).success).toBe(false);
  });
});

describe("assess", () => {
  it("calls a fully filled profile complete", () => {
    const r = assess(parse());
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("an empty profile is missing every required field, each with a question", () => {
    const r = assess(empty());
    expect(r.complete).toBe(false);
    expect(r.missing.map((g) => g.field)).toEqual([
      "name", "contact.email", "contact.phone", "contact.location", "headline", "summary", "skills", "experience",
      "preferences.seniority", "preferences.targetRoles", "preferences.keywords", "preferences.locations",
      "answers.noticePeriod", "answers.workAuthorization",
    ]);
    for (const g of r.missing) expect(g.question.endsWith("?") || g.question.endsWith(".")).toBe(true);
  });

  it("a resume alone leaves the job preferences missing", () => {
    const fromResume = mergeProfile(null, {
      name: "A B", headline: "Dev", summary: "s",
      contact: { email: "a@b.co", phone: "+1 222 333 4444", location: "X, Y" },
      skills: [{ group: "languages", items: ["Go"] }],
      experience: [{ title: "Dev", company: "Co", start: "2022-01", highlights: [] }],
    });
    expect(fields(fromResume)).toEqual([
      "preferences.seniority", "preferences.targetRoles", "preferences.keywords", "preferences.locations",
      "answers.noticePeriod", "answers.workAuthorization",
    ]);
  });

  it("education counts as background for someone with no work history yet", () => {
    expect(fields(parse({ experience: [] }))).not.toContain("experience");
    expect(fields(parse({ experience: [], education: [] }))).toContain("experience");
  });

  it("whitespace does not count as an answer", () => {
    expect(fields(parse({ name: "   " }))).toContain("name");
    expect(fields(parse({ answers: { noticePeriod: " ", workAuthorization: "yes" } }))).toContain("answers.noticePeriod");
  });

  it("empty skill groups do not count as skills", () => {
    expect(fields(parse({ skills: { languages: [] } }))).toContain("skills");
  });

  it("asks optional questions without blocking completeness", () => {
    const base = parse({ preferences: { ...sampleProfile().preferences, dealbreakers: [], locations: { Home: { workMode: ["remote"] } } }, contact: { email: "a@b.co", phone: "1", location: "x" } });
    const r = assess(base);
    expect(r.complete).toBe(true);
    expect(r.optional.map((g) => g.field)).toEqual([
      "preferences.locations[].minSalaryINR", "preferences.dealbreakers", "contact.links",
    ]);
  });

  it("stops asking about salary floors, dealbreakers and links once they are set", () => {
    const p = parse({ preferences: { ...sampleProfile().preferences, locations: { Home: { workMode: ["remote"], minSalaryINR: 1_000_000 } } } });
    expect(assess(p).optional).toEqual([]);
  });
});

describe("mergeProfile", () => {
  it("starts from an empty profile when there is none", () => {
    const p = mergeProfile(null, { name: "Ada", contact: { email: "ada@example.com" } });
    expect(p.name).toBe("Ada");
    expect(p.contact).toMatchObject({ email: "ada@example.com", phone: "" });
    expect(p.preferences.minScore).toBe(70);
  });

  it("overwrites scalars and leaves everything not mentioned alone", () => {
    const before = parse();
    const after = mergeProfile(before, { headline: "Staff Engineer" });
    expect(after.headline).toBe("Staff Engineer");
    expect({ ...after, headline: before.headline }).toEqual(before);
  });

  it("merges contact fields one by one and ignores fields that are not sent", () => {
    const after = mergeProfile(parse(), { contact: { phone: "+44 7000 000000", linkedin: "https://linkedin.com/in/tc" } });
    expect(after.contact).toMatchObject({
      email: "test.candidate@example.com", phone: "+44 7000 000000", location: "Lisbon, Portugal",
      github: "https://github.com/tc", linkedin: "https://linkedin.com/in/tc",
    });
  });

  it("turns skill entries into groups and replaces only the groups it is given", () => {
    const after = mergeProfile(parse(), { skills: [{ group: "backend", items: ["Rust"] }, { group: "cloud", items: ["AWS"] }] });
    expect(after.skills).toEqual({ languages: ["Go", "Python"], backend: ["Rust"], cloud: ["AWS"] });
  });

  it("marks an experience entry without an end date as the current job", () => {
    const after = mergeProfile(null, {
      experience: [
        { title: "A", company: "X", start: "2022-01", highlights: [] },
        { title: "B", company: "Y", start: "2020-01", end: "2021-12", highlights: [] },
      ],
    });
    expect(after.experience.map((e) => [e.end, e.current])).toEqual([[null, true], ["2021-12", false]]);
  });

  it("replaces lists such as experience and projects when they are sent", () => {
    const after = mergeProfile(parse(), { projects: [{ name: "only-one", tech: [], highlights: [] }] });
    expect(after.projects.map((p) => p.name)).toEqual(["only-one"]);
    expect(after.experience).toHaveLength(2);
  });

  it("merges preference fields and location rules by name", () => {
    const after = mergeProfile(parse(), {
      preferences: {
        seniority: "senior",
        locations: [{ name: "EU", workMode: ["remote", "hybrid"] }, { name: "UK", workMode: ["remote"], minSalaryINR: 3_000_000 }],
      },
    });
    expect(after.preferences.seniority).toBe("senior");
    expect(after.preferences.targetRoles).toEqual(["Backend Engineer", "Platform Engineer"]);
    expect(Object.keys(after.preferences.locations).sort()).toEqual(["EU", "Portugal", "UK"]);
    expect(after.preferences.locations.EU).toEqual({ workMode: ["remote", "hybrid"] });
    expect(after.preferences.locations.Portugal!.minSalaryINR).toBe(2_000_000);
  });

  it("merges answers by key", () => {
    const after = mergeProfile(parse(), { answers: [{ key: "noticePeriod", value: "30 days" }, { key: "relocation", value: "open" }] });
    expect(after.answers).toEqual({ noticePeriod: "30 days", workAuthorization: "EU citizen", relocation: "open" });
  });

  it("does not modify the profile it was given", () => {
    const before = parse();
    const snapshot = JSON.stringify(before);
    mergeProfile(before, { name: "Changed", skills: [{ group: "x", items: ["y"] }], preferences: { locations: [{ name: "Z", workMode: ["remote"] }] } });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("refuses a result that breaks the schema, with a readable path", () => {
    expect(() => mergeProfile(null, { experience: [{ title: "t", company: "c", start: "last year", highlights: [] }] })).toThrow(/start/);
    expect(() => mergeProfile(null, { contact: { email: "nope" } })).toThrow(/email/);
  });
});

describe("PatchSchema (what the model sends)", () => {
  it("accepts a partial patch and rejects unknown work modes", () => {
    expect(PatchSchema.safeParse({ name: "x" }).success).toBe(true);
    expect(PatchSchema.safeParse({ preferences: { locations: [{ name: "X", workMode: ["anywhere"] }] } }).success).toBe(false);
  });
});

describe("profile file", () => {
  let env: ReturnType<typeof useProfile>;
  afterEach(() => env?.cleanup());

  it("reports a missing file", async () => {
    env = useProfile(null);
    expect(await readProfile()).toEqual({ state: "missing" });
  });

  it("reads a valid profile and applies defaults", async () => {
    env = useProfile({ name: "Only Name" });
    const r = await readProfile();
    expect(r.state).toBe("ok");
    if (r.state === "ok") expect(r.profile.skills).toEqual({});
  });

  it("reports broken JSON instead of throwing", async () => {
    env = useProfile(null);
    writeFileSync(env.profilePath, "{ nope");
    const r = await readProfile();
    expect(r.state).toBe("invalid");
    if (r.state === "invalid") expect(r.problems[0]).toMatch(/not valid JSON/);
  });

  it("reports schema problems with their location", async () => {
    env = useProfile({ contact: { email: "bad" }, preferences: { minScore: 500 } });
    const r = await readProfile();
    expect(r.state).toBe("invalid");
    if (r.state === "invalid") {
      expect(r.problems.join("\n")).toMatch(/contact\.email/);
      expect(r.problems.join("\n")).toMatch(/preferences\.minScore/);
    }
  });

  it("requireProfile gives the model clear instructions when there is no profile", async () => {
    env = useProfile(null);
    await expect(requireProfile()).rejects.toThrow(NO_PROFILE);
    expect(NO_PROFILE).toMatch(/profile_status/);
  });

  it("requireProfile explains a damaged profile", async () => {
    env = useProfile(null);
    writeFileSync(env.profilePath, "[]");
    await expect(requireProfile()).rejects.toThrow(/invalid/);
  });

  it("writeProfile creates the folder, writes valid JSON and leaves no temp file behind", async () => {
    env = useProfile(null);
    const nested = `${env.dir}/deep/er/profile.json`;
    process.env.PROFILE_PATH = nested;
    await writeProfile(parse());
    expect(JSON.parse(readFileSync(nested, "utf8")).name).toBe("Test Candidate");
    expect(existsSync(`${nested}.tmp`)).toBe(false);
    expect((await readProfile()).state).toBe("ok");
  });

  it("a second write fully replaces the first", async () => {
    env = useProfile(null);
    await writeProfile(parse({ name: "First" }));
    await writeProfile(parse({ name: "Second" }));
    expect(JSON.parse(readFileSync(env.profilePath, "utf8")).name).toBe("Second");
  });
});

describe("alertEmail", () => {
  let env: ReturnType<typeof useProfile>;
  afterEach(() => env?.cleanup());

  it("uses the email on the profile", async () => {
    env = useProfile();
    expect(await alertEmail()).toBe("test.candidate@example.com");
  });

  it("ALERT_TO_EMAIL wins over the profile", async () => {
    env = useProfile();
    process.env.ALERT_TO_EMAIL = "elsewhere@example.com";
    expect(await alertEmail()).toBe("elsewhere@example.com");
  });

  it("works from ALERT_TO_EMAIL alone, with no profile at all", async () => {
    env = useProfile(null);
    process.env.ALERT_TO_EMAIL = "elsewhere@example.com";
    expect(await alertEmail()).toBe("elsewhere@example.com");
  });

  it("fails clearly when there is nowhere to send alerts", async () => {
    env = useProfile(null);
    await expect(alertEmail()).rejects.toThrow(/ALERT_TO_EMAIL/);
  });
});

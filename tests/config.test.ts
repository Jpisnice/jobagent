import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import companies from "../data/companies.json";
import example from "../data/profile.example.json";
import { assess, ProfileSchema } from "../agent/lib/profile";
import { sources } from "../agent/lib/sources";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const toolFiles = readdirSync(join(root, "agent/tools")).filter((f) => f.endsWith(".ts")).map((f) => f.replace(/\.ts$/, ""));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("data/companies.json", () => {
  const entries = Object.entries(companies as Record<string, string[]>);

  it("has a list for every company-board provider, and only those", () => {
    const ats = Object.values(sources).filter((s) => s.kind === "ats").map((s) => s.id).sort();
    expect(entries.map(([k]) => k).sort()).toEqual(ats);
  });

  it.each(entries)("%s: slugs are non-empty, trimmed strings without duplicates", (_name, slugs) => {
    expect(slugs.length).toBeGreaterThan(0);
    for (const s of slugs) {
      expect(typeof s).toBe("string");
      expect(s).toBe(s.trim());
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/[\s/]/);
    }
    expect(new Set(slugs.map((s) => s.toLowerCase())).size).toBe(slugs.length);
  });
});

describe("data/profile.example.json", () => {
  const parsed = ProfileSchema.parse(example);

  it("is a valid, complete profile, so it documents every field the tools understand", () => {
    expect(ProfileSchema.safeParse(example).success).toBe(true);
    expect(assess(parsed)).toMatchObject({ complete: true, missing: [] });
  });

  it("shows well-formed experience with at most one current job", () => {
    for (const e of parsed.experience) expect(e.current).toBe(e.end === null);
    expect(parsed.experience.filter((e) => e.current).length).toBeLessThanOrEqual(1);
  });

  it("shows location rules with a work mode and an annual INR salary floor", () => {
    for (const rule of Object.values(parsed.preferences.locations)) {
      expect(rule.workMode.length).toBeGreaterThan(0);
      expect(rule.minSalaryINR).toBeGreaterThan(0);
    }
  });

  it("holds no real personal data", () => {
    const text = JSON.stringify(example);
    expect(text).toContain("you@example.com");
    expect(text).not.toMatch(/gmail\.com|\+91/);
  });
});

describe("the real profile, when there is one", () => {
  const file = join(root, "data/profile.json");

  it.skipIf(!existsSync(file))("data/profile.json still matches the schema", () => {
    const result = ProfileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    expect(result.error?.issues ?? []).toEqual([]);
  });
});

describe("schedule", () => {
  it("runs on a valid 5-field cron and tells the agent never to apply", async () => {
    const def = (await import("../agent/schedules/job-search")).default as any;
    expect(def.cron.trim().split(/\s+/)).toHaveLength(5);
    expect(def.markdown).toMatch(/matcher/);
    expect(def.markdown).toMatch(/Do NOT submit/i);
    expect(def.markdown).toMatch(/fetch_jobs/);
  });

  it("checks the profile first and never tries to onboard, since a schedule cannot ask questions", async () => {
    const def = (await import("../agent/schedules/job-search")).default as any;
    expect(def.markdown.indexOf("profile_status")).toBeGreaterThanOrEqual(0);
    expect(def.markdown.indexOf("profile_status")).toBeLessThan(def.markdown.indexOf("fetch_jobs"));
    expect(def.markdown).toMatch(/missing or incomplete.*send_alert.*stop/s);
  });
});

describe("agent settings", () => {
  it("sets a context window, compaction and usage caps so sessions cannot run away", async () => {
    const def = (await import("../agent/agent")).default as any;
    expect(def.modelContextWindowTokens).toBeGreaterThan(0);
    expect(def.compaction.thresholdPercent).toBeGreaterThan(0);
    expect(def.compaction.thresholdPercent).toBeLessThan(1);
    expect(def.limits.maxInputTokensPerSession).toBeGreaterThan(0);
    expect(def.limits.maxOutputTokensPerSession).toBeGreaterThan(0);
  });

  it("gives the matcher a hard, small budget", async () => {
    const def = (await import("../agent/subagents/matcher/agent")).default as any;
    expect(def.description).toBeTruthy();
    expect(def.reasoning).toBe("minimal");
    expect(def.limits.maxOutputTokensPerSession).toBeLessThanOrEqual(5_000);
    expect(def.limits.maxInputTokensPerSession).toBeLessThanOrEqual(100_000);
  });
});

describe("tool definitions", () => {
  const own = [
    "approve_application", "browser_submit", "browser_task", "draft_application", "fetch_jobs", "get_profile",
    "profile_status", "read_resume", "record_job", "save_profile", "send_alert",
  ];

  // Gemini rejects free-form maps ("Unsupported type: OBJECT"), so inputs must use lists of entries instead.
  it.each(own)("%s has an input schema without free-form maps", async (name) => {
    const tool = (await import(`../agent/tools/${name}.ts`)).default as any;
    const json = JSON.stringify(z.toJSONSchema(tool.inputSchema, { io: "input" }));
    expect(json).not.toMatch(/"additionalProperties":\{/);
    expect(json).not.toMatch(/"propertyNames"/);
  });

  it.each(own)("%s has a description and an input schema", async (name) => {
    const tool = (await import(`../agent/tools/${name}.ts`)).default as any;
    expect(tool.description.length).toBeGreaterThan(30);
    expect(typeof tool.inputSchema.parse).toBe("function");
    expect(typeof tool.execute).toBe("function");
  });

  it("the free-form-map guard really detects a map", () => {
    const json = JSON.stringify(z.toJSONSchema(z.object({ answers: z.record(z.string(), z.string()) }), { io: "input" }));
    expect(json).toMatch(/"additionalProperties":\{|"propertyNames"/);
  });

  it("only the approval-gated tools can finish an application", async () => {
    const gated: string[] = [];
    for (const name of toolFiles) {
      const tool = (await import(`../agent/tools/${name}.ts`)).default as any;
      if (typeof tool?.approval === "function") gated.push(name);
    }
    expect(gated.sort()).toEqual(["approve_application", "browser_submit"]);
  });

  it("web_search stays disabled because Gemini cannot mix it with function tools", () => {
    expect(read("agent/tools/web_search.ts")).toMatch(/disableTool\(\)/);
  });
});

describe("instructions", () => {
  const instructions = read("agent/instructions.md");
  const subagents = readdirSync(join(root, "agent/subagents"));
  const known = new Set([...toolFiles, ...subagents]);
  // Tokens in backticks that are statuses or fields, not tools.
  const notTools = new Set(["needs_human", "needs_submit_approval", "min_score"]);

  it("only names tools and subagents that exist", () => {
    const named = [...instructions.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]!).filter((t) => !notTools.has(t));
    const missing = named.filter((t) => !known.has(t));
    expect(missing).toEqual([]);
  });

  it("names the matcher subagent and the approval tools", () => {
    expect(subagents).toContain("matcher");
    for (const t of ["matcher", "approve_application", "browser_task", "browser_submit", "fetch_jobs", "send_alert"]) {
      expect(instructions).toContain(`\`${t}\``);
    }
  });

  it("tells the agent to check the profile first and how to onboard a new user", () => {
    const onboarding = instructions.slice(instructions.indexOf("# Profile onboarding"), instructions.indexOf("# Workflow"));
    expect(onboarding.length).toBeGreaterThan(200);
    for (const t of ["profile_status", "read_resume", "save_profile", "ask_question", "send_alert"]) {
      expect(onboarding).toContain(`\`${t}\``);
    }
    expect(onboarding).toMatch(/FIRST/);
    expect(onboarding).toMatch(/Scheduled runs cannot ask questions/);
    expect(onboarding).toMatch(/Never invent/);
  });

  it("onboarding comes before the job workflow", () => {
    expect(instructions.indexOf("# Profile onboarding")).toBeGreaterThan(0);
    expect(instructions.indexOf("# Profile onboarding")).toBeLessThan(instructions.indexOf("# Workflow"));
  });

  it("keeps the safety rules", () => {
    expect(instructions).toMatch(/Never submit an application without an approved/i);
    expect(instructions).toMatch(/Never invent/i);
  });

  it("matcher instructions only use the matcher's own tool and ask for compact json", () => {
    const text = read("agent/subagents/matcher/instructions.md");
    expect(text).toContain("get_profile");
    expect(text).not.toMatch(/fetch_jobs|send_alert|browser_/);
    expect(text).toMatch(/ONLY a compact JSON array/);
  });
});

describe("no leftovers from removed setups", () => {
  const files = walk(join(root, "agent")).filter((f) => /\.(ts|md)$/.test(f));

  it("nothing under agent/ refers to Browserbase, Playwright or the old chrome_ tools", () => {
    const hits = files.filter((f) => /browserbase|playwright|chrome_(open|click|fill|snapshot|press|upload|submit)/i.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the old tool files are gone", () => {
    for (const f of ["agent/lib/chrome.ts", "agent/tools/chrome_open.ts", "agent/extensions"]) {
      expect(existsSync(join(root, f))).toBe(false);
    }
  });

  it("package.json has no Browserbase or Playwright dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(deps.filter((d) => /browserbase|playwright/i.test(d))).toEqual([]);
  });

  it("secrets and local browser data stay out of git", () => {
    const ignore = read(".gitignore");
    for (const entry of [".env", ".chrome-profile", ".data", "browser-service/.venv", "data/profile.json", "data/resume.*"]) {
      expect(ignore).toContain(entry);
    }
  });
});

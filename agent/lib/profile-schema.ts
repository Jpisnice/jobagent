import { z } from "zod";

// The job profile: who the candidate is (from the resume) plus what they want (asked in chat).
// Stored fields are lenient on purpose: a half-finished profile can be saved, and `assess` says
// what is still missing. Format is only checked when a value is present.

const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "use YYYY-MM, for example 2024-07");
const email = z
  .string()
  .refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "not a valid email address");
const workMode = z.enum(["remote", "onsite", "hybrid"]);

export const ExperienceSchema = z.object({
  title: z.string().min(1),
  company: z.string().min(1),
  start: yearMonth,
  end: yearMonth.nullable().default(null),
  current: z.boolean().default(false),
  highlights: z.array(z.string()).default([]),
});

export const ProjectSchema = z.object({
  name: z.string().min(1),
  url: z.string().optional(),
  metrics: z.string().optional(),
  tech: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
});

export const EducationSchema = z.object({
  degree: z.string().min(1),
  institution: z.string().min(1),
  start: z.number().int().optional(),
  end: z.number().int().optional(),
  score: z.string().optional(),
});

export const CertificationSchema = z.object({ name: z.string().min(1), issuer: z.string().optional() });

// One rule per place or group of places the candidate would work in, for example "India" or "abroad".
export const LocationRuleSchema = z.object({
  workMode: z.array(workMode).min(1),
  required: z.boolean().optional(), // true: the work mode is a hard rule, not just a preference
  preferred: workMode.optional(),
  regions: z.array(z.string()).optional(),
  minSalaryINR: z.number().positive().optional(), // annual, in INR
});

export const ProfileSchema = z.object({
  name: z.string().default(""),
  headline: z.string().default(""),
  contact: z
    .object({
      email: email.default(""),
      phone: z.string().default(""),
      location: z.string().default(""),
      github: z.string().optional(),
      linkedin: z.string().optional(),
      website: z.string().optional(),
    })
    .default({ email: "", phone: "", location: "" }),
  summary: z.string().default(""),
  strengths: z.array(z.string()).default([]),
  skills: z.record(z.string(), z.array(z.string())).default({}),
  experience: z.array(ExperienceSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  education: z.array(EducationSchema).default([]),
  certifications: z.array(CertificationSchema).default([]),
  preferences: z
    .object({
      seniority: z.string().default(""),
      targetRoles: z.array(z.string()).default([]),
      keywords: z.array(z.string()).default([]),
      locations: z.record(z.string(), LocationRuleSchema).default({}),
      remoteOk: z.boolean().default(true),
      dealbreakers: z.array(z.string()).default([]),
      minScore: z.number().min(0).max(100).default(70),
      notes: z.string().optional(),
    })
    .default({ seniority: "", targetRoles: [], keywords: [], locations: {}, remoteOk: true, dealbreakers: [], minScore: 70 }),
  answers: z.record(z.string(), z.string()).default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;

// ---- What the model sends to save_profile -------------------------------------------------
// Gemini rejects free-form maps in tool schemas, so maps travel as lists of entries.

export const PatchSchema = z.object({
  name: z.string().optional(),
  headline: z.string().optional(),
  summary: z.string().optional(),
  contact: z
    .object({
      email: z.string().optional(),
      phone: z.string().optional(),
      location: z.string().optional(),
      github: z.string().optional(),
      linkedin: z.string().optional(),
      website: z.string().optional(),
    })
    .optional(),
  strengths: z.array(z.string()).optional(),
  skills: z
    .array(z.object({ group: z.string().min(1), items: z.array(z.string()) }))
    .optional()
    .describe("Skills grouped by area, for example languages, frontend, backend, data_infra, ai_ml"),
  experience: z
    .array(
      z.object({
        title: z.string(),
        company: z.string(),
        start: z.string().describe("YYYY-MM"),
        end: z.string().optional().describe("YYYY-MM; leave out for the current job"),
        highlights: z.array(z.string()).default([]),
      }),
    )
    .optional()
    .describe("Replaces the whole experience list when given"),
  projects: z
    .array(
      z.object({
        name: z.string(),
        url: z.string().optional(),
        metrics: z.string().optional(),
        tech: z.array(z.string()).default([]),
        highlights: z.array(z.string()).default([]),
      }),
    )
    .optional(),
  education: z
    .array(
      z.object({
        degree: z.string(),
        institution: z.string(),
        start: z.number().int().optional(),
        end: z.number().int().optional(),
        score: z.string().optional(),
      }),
    )
    .optional(),
  certifications: z.array(z.object({ name: z.string(), issuer: z.string().optional() })).optional(),
  preferences: z
    .object({
      seniority: z.string().optional().describe("entry, mid or senior"),
      targetRoles: z.array(z.string()).optional(),
      keywords: z.array(z.string()).optional().describe("Skills and terms to search job boards for"),
      dealbreakers: z.array(z.string()).optional(),
      remoteOk: z.boolean().optional(),
      minScore: z.number().min(0).max(100).optional(),
      notes: z.string().optional(),
      locations: z
        .array(
          z.object({
            name: z.string().min(1).describe("Rule name, for example India, UK or abroad"),
            workMode: z.array(workMode).min(1),
            required: z.boolean().optional().describe("true if the work mode is a hard rule"),
            preferred: workMode.optional(),
            regions: z.array(z.string()).optional(),
            minSalaryINR: z.number().positive().optional().describe("Annual salary floor in INR"),
          }),
        )
        .optional()
        .describe("Merged by name into the existing rules"),
    })
    .optional(),
  answers: z
    .array(z.object({ key: z.string().min(1), value: z.string() }))
    .optional()
    .describe("Standard application answers, for example noticePeriod and workAuthorization; merged by key"),
});

export type Patch = z.infer<typeof PatchSchema>;

const defined = <T extends object>(o: T | undefined) =>
  Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));

// Applies a patch: scalars overwrite, contact and preferences merge field by field, skill groups,
// location rules and answers merge by key, and the other lists are replaced when provided.
export function mergeProfile(existing: Profile | null, patch: Patch): Profile {
  const base = existing ?? ProfileSchema.parse({});
  const next: Record<string, unknown> = { ...base };

  for (const key of ["name", "headline", "summary"] as const) if (patch[key] !== undefined) next[key] = patch[key];
  for (const key of ["strengths", "projects", "education", "certifications"] as const) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  if (patch.contact) next.contact = { ...base.contact, ...defined(patch.contact) };
  if (patch.skills) {
    const skills = { ...base.skills };
    for (const g of patch.skills) skills[g.group] = g.items;
    next.skills = skills;
  }
  if (patch.experience) {
    next.experience = patch.experience.map((e) => ({ ...e, end: e.end ?? null, current: e.end === undefined }));
  }
  if (patch.preferences) {
    const { locations, ...rest } = patch.preferences;
    const prefs: Record<string, unknown> = { ...base.preferences, ...defined(rest) };
    if (locations) {
      const merged = { ...base.preferences.locations };
      for (const { name, ...rule } of locations) merged[name] = defined(rule) as never;
      prefs.locations = merged;
    }
    next.preferences = prefs;
  }
  if (patch.answers) {
    const answers = { ...base.answers };
    for (const a of patch.answers) answers[a.key] = a.value;
    next.answers = answers;
  }
  return ProfileSchema.parse(next);
}

// ---- Completeness ---------------------------------------------------------------------------

export interface Gap {
  field: string;
  question: string;
}

const blank = (s: string | undefined) => !s || s.trim() === "";

// `missing` blocks the profile from being complete; `optional` is worth asking once but never blocks.
export function assess(p: Profile): { complete: boolean; missing: Gap[]; optional: Gap[] } {
  const missing: Gap[] = [];
  const optional: Gap[] = [];
  const need = (field: string, question: string, ok: boolean) => {
    if (!ok) missing.push({ field, question });
  };

  need("name", "What is your full name?", !blank(p.name));
  need("contact.email", "Which email address should applications use?", !blank(p.contact.email));
  need("contact.phone", "What phone number should applications use (with country code)?", !blank(p.contact.phone));
  need("contact.location", "Which city and country are you based in?", !blank(p.contact.location));
  need("headline", "In a few words, how would you describe yourself professionally (for example 'Full Stack Developer')?", !blank(p.headline));
  need("summary", "Write a two or three sentence professional summary (or let me draft one from your resume).", !blank(p.summary));
  need("skills", "Which skills and technologies do you work with?", Object.values(p.skills).some((items) => items.length > 0));
  need(
    "experience",
    "What work or internship experience do you have (title, company, dates), or studies if you are just starting?",
    p.experience.length > 0 || p.education.length > 0,
  );
  need("preferences.seniority", "What level are you looking for: entry, mid or senior?", !blank(p.preferences.seniority));
  need("preferences.targetRoles", "Which roles are you targeting (for example Full Stack Developer, AI Engineer)?", p.preferences.targetRoles.length > 0);
  need("preferences.keywords", "Which skills or keywords should I search job boards for?", p.preferences.keywords.length > 0);
  need(
    "preferences.locations",
    "Where would you work, and how: remote, on-site or hybrid? Say if remote is a must for any country.",
    Object.keys(p.preferences.locations).length > 0,
  );
  need("answers.noticePeriod", "What is your notice period (for example 30 days, immediate)?", !blank(p.answers.noticePeriod));
  need(
    "answers.workAuthorization",
    "Are you authorized to work in the countries you are applying to? Do you need visa sponsorship anywhere?",
    !blank(p.answers.workAuthorization),
  );

  const rules = Object.entries(p.preferences.locations);
  if (rules.length > 0 && rules.some(([, r]) => r.minSalaryINR === undefined)) {
    optional.push({
      field: "preferences.locations[].minSalaryINR",
      question: "Is there a minimum yearly salary (in INR) for each place? Skip if there is none.",
    });
  }
  if (p.preferences.dealbreakers.length === 0) {
    optional.push({
      field: "preferences.dealbreakers",
      question: "Anything you would never consider (industries, companies, technologies)? Skip if nothing.",
    });
  }
  if (blank(p.contact.linkedin) && blank(p.contact.github)) {
    optional.push({ field: "contact.links", question: "Do you want to include a LinkedIn or GitHub link on applications?" });
  }
  return { complete: missing.length === 0, missing, optional };
}

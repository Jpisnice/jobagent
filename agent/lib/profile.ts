import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ProfileSchema, type Profile } from "./profile-schema";

export { assess, mergeProfile, ProfileSchema, PatchSchema } from "./profile-schema";
export type { Profile, Patch } from "./profile-schema";

// The profile is a plain file that the onboarding tools write at runtime (data/profile.json,
// git-ignored). Like the job store it is local: on Vercel the filesystem is ephemeral.
const file = () => resolve(process.env.PROFILE_PATH ?? "data/profile.json");

export const NO_PROFILE =
  "There is no job profile yet. Call profile_status and run profile onboarding: ask the user for their resume, build the profile with save_profile, then ask about anything still missing.";

export type ProfileRead =
  | { state: "missing" }
  | { state: "invalid"; problems: string[] }
  | { state: "ok"; profile: Profile };

export async function readProfile(): Promise<ProfileRead> {
  let raw: string;
  try {
    raw = await readFile(file(), "utf8");
  } catch {
    return { state: "missing" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { state: "invalid", problems: [`not valid JSON: ${(e as Error).message}`] };
  }
  const parsed = ProfileSchema.safeParse(json);
  if (!parsed.success) {
    return { state: "invalid", problems: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  return { state: "ok", profile: parsed.data };
}

// For tools that need a profile to work: fails with an instruction the model can follow.
export async function requireProfile(): Promise<Profile> {
  const r = await readProfile();
  if (r.state === "missing") throw new Error(NO_PROFILE);
  if (r.state === "invalid") throw new Error(`The saved profile is invalid (${r.problems.join("; ")}). Fix it with save_profile.`);
  return r.profile;
}

// Writes via a temp file and rename so a crash can never leave half a profile on disk.
export async function writeProfile(profile: Profile): Promise<void> {
  const target = file();
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(profile, null, 2) + "\n");
  await rename(tmp, target);
}

// Where alerts go: ALERT_TO_EMAIL if set, otherwise the email on the profile.
export async function alertEmail(): Promise<string> {
  if (process.env.ALERT_TO_EMAIL) return process.env.ALERT_TO_EMAIL;
  const r = await readProfile();
  const email = r.state === "ok" ? r.profile.contact.email : "";
  if (!email) throw new Error("No alert email: set ALERT_TO_EMAIL or add an email to the profile.");
  return email;
}

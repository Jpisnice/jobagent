import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

export type JobStatus = "seen" | "notified" | "approved" | "applied" | "failed" | "skipped";

export interface JobRecord {
  id: string;
  url: string;
  title: string;
  company: string;
  score?: number;
  status: JobStatus;
  note?: string;
  updatedAt: string;
}

// Local JSON file. Fine for `eve dev` / `eve start`; on Vercel the filesystem is
// ephemeral, so swap these two functions for Blob/KV before deploying.
const FILE = process.env.JOB_STORE_PATH ?? ".data/jobs.json";

export const jobId = (url: string) =>
  createHash("sha256").update(url.split("#")[0]!.replace(/\/$/, "")).digest("hex").slice(0, 16);

async function load(): Promise<Record<string, JobRecord>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function getJobs(): Promise<Record<string, JobRecord>> {
  return load();
}

// Tools can run in parallel; serialize read-modify-write so updates are not lost.
let queue: Promise<unknown> = Promise.resolve();

export function upsertJob(
  rec: Omit<JobRecord, "id" | "updatedAt"> & { id?: string },
): Promise<JobRecord> {
  const run = queue.then(() => write(rec));
  queue = run.catch(() => undefined);
  return run;
}

async function write(
  rec: Omit<JobRecord, "id" | "updatedAt"> & { id?: string },
): Promise<JobRecord> {
  const all = await load();
  const id = rec.id ?? jobId(rec.url);
  const next: JobRecord = { ...all[id], ...rec, id, updatedAt: new Date().toISOString() };
  all[id] = next;
  await mkdir(dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(all, null, 2));
  return next;
}

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { urlKey } from "./screening";

export type JobStatus = "seen" | "notified" | "approved" | "applied" | "failed" | "skipped";
export const JOB_STATUSES: readonly JobStatus[] = ["seen", "notified", "approved", "applied", "failed", "skipped"];

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

type JobUpdate = Omit<JobRecord, "id" | "updatedAt"> & { id?: string };

// Local JSON file. Fine for `eve dev` / `eve start`; on Vercel the filesystem is
// ephemeral, so swap load() and save() for Blob/KV before deploying.
const FILE = process.env.JOB_STORE_PATH ?? ".data/jobs.json";

export const jobId = (url: string) =>
  createHash("sha256").update(urlKey(url)).digest("hex").slice(0, 16);

async function load(): Promise<Record<string, JobRecord>> {
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

// Writes via a temp file and rename so a crash can never leave half a store on disk.
async function save(all: Record<string, JobRecord>): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(all, null, 2));
  await rename(tmp, FILE);
}

export async function getJobs(): Promise<Record<string, JobRecord>> {
  return load();
}

// Tools can run in parallel; serialize read-modify-write so updates are not lost.
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn);
  queue = run.catch(() => undefined);
  return run;
};

export function upsertJob(rec: JobUpdate): Promise<JobRecord> {
  return serialized(async () => (await write([rec]))[0]!);
}

// Many records in one read and one write, for a whole batch of verdicts.
export function upsertJobs(recs: JobUpdate[]): Promise<JobRecord[]> {
  return serialized(() => write(recs));
}

async function write(recs: JobUpdate[]): Promise<JobRecord[]> {
  const all = await load();
  const now = new Date().toISOString();
  const out = recs.map((rec) => {
    const id = rec.id ?? jobId(rec.url);
    const next: JobRecord = { ...all[id], ...rec, id, updatedAt: now };
    all[id] = next;
    return next;
  });
  await save(all);
  return out;
}

// Newest first, filtered by status and last update, with a count per status over everything stored.
export async function listJobs(filter: { status?: JobStatus[]; since?: string; limit?: number } = {}) {
  const all = Object.values(await load());
  const counts = Object.fromEntries(JOB_STATUSES.map((s) => [s, 0])) as Record<JobStatus, number>;
  for (const j of all) counts[j.status] = (counts[j.status] ?? 0) + 1;
  const matching = all
    .filter((j) => !filter.status?.length || filter.status.includes(j.status))
    .filter((j) => !filter.since || j.updatedAt >= filter.since)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { total: all.length, counts, matching: matching.length, jobs: matching.slice(0, filter.limit ?? 20) };
}

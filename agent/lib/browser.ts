// Client for the local browser-use service (browser-service/server.py).
const baseUrl = () => (process.env.BROWSER_SERVICE_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "");

const NOT_RUNNING =
  "The local browser service is not running. Ask the user to start it in a terminal with `npm run browser`, sign in to any job sites in the Chrome window it opens, then try again.";

async function call(path: string, init: RequestInit = {}): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-token": process.env.BROWSER_SERVICE_TOKEN ?? "",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(NOT_RUNNING);
  }
  if (res.status === 401) throw new Error("Browser service rejected the token. Check BROWSER_SERVICE_TOKEN in .env matches on both sides.");
  if (!res.ok) throw new Error(`Browser service ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export interface TaskResult {
  status: "running" | "done" | "failed" | "needs_human" | "needs_submit_approval";
  steps: number;
  result: string | null;
  reason: string | null;
  seconds: number;
}

// Starts a task and waits for it to finish, cancelling it if the turn is aborted.
export async function runTask(
  body: { task: string; files?: string[]; maxSteps?: number; key: string; allowSubmit?: boolean },
  abortSignal?: AbortSignal,
  timeoutMs = 12 * 60_000,
): Promise<TaskResult> {
  const { jobId } = await call("/run", {
    method: "POST",
    body: JSON.stringify({
      task: body.task,
      files: body.files ?? [],
      max_steps: body.maxSteps ?? 60,
      key: body.key,
      allow_submit: body.allowSubmit ?? false,
    }),
  });

  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (abortSignal?.aborted || Date.now() > deadline) {
      await call(`/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => undefined);
      throw new Error(abortSignal?.aborted ? "Browser task cancelled." : "Browser task timed out after 12 minutes.");
    }
    const job: TaskResult = await call(`/jobs/${jobId}`);
    if (job.status !== "running") return job;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

export async function health(): Promise<boolean> {
  try {
    await call("/health");
    return true;
  } catch {
    return false;
  }
}

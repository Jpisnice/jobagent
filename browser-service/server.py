"""Local browser-use service for the job agent.

Runs browser-use (driven by Gemini) against a headed Chrome that you start with
scripts/browser.ps1. The eve agent calls this over HTTP on 127.0.0.1.

  POST /run               start a task, returns {jobId} immediately (idempotent on `key`)
  GET  /jobs/{id}         status: running | done | failed | needs_human | needs_submit_approval
  POST /jobs/{id}/cancel  stop a running job
  GET  /health

One job runs at a time because there is one Chrome window.
"""

import asyncio
import hmac
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
os.environ.setdefault("ANONYMIZED_TELEMETRY", "false")

from browser_use import ActionResult, Agent, Browser, ChatGoogle, Tools  # noqa: E402

DATA_DIR = (ROOT / "data").resolve()
CDP_URL = os.getenv("BROWSER_CDP_URL", "http://127.0.0.1:9222")
MODEL = os.getenv("BROWSER_USE_MODEL", "gemini-3-flash-preview")
FALLBACK_MODEL = os.getenv("BROWSER_USE_FALLBACK_MODEL", "gemini-2.5-flash")
API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
TOKEN = os.getenv("BROWSER_SERVICE_TOKEN")

# Buttons that really send an application. Starting the flow ("Apply for this job") is fine.
FINAL_SUBMIT = re.compile(
    r"^(submit|send)\b|submit (your )?application|send application|complete application"
    r"|finish application|confirm and submit",
    re.I,
)

RULES = """
You are filling in a job application in the user's own Chrome window. Rules:
- Work in the current tab. Use ONLY the values given in the task; never invent answers. If a required
  answer is not given, leave the field and report it in your final result.
- Never type into password fields and never create an account or sign in. If you hit a login wall,
  account creation, a CAPTCHA, a verification code or anything else you cannot do, call the
  ask_human action with a clear reason and stop. The user will fix it in the window and you will be
  run again from the same page.
- Dropdowns and comboboxes: click the field, type part of the value, wait for the options, then click
  the matching option. Verify the field shows the value afterwards.
- To upload a file, use the upload_file action with the exact absolute path given in the task.
- After filling, re-read the form and check every field, then stop. {submit_rule}
- In your final result, list each field you filled, anything you could not fill, and the current page.
"""

NO_SUBMIT = (
    "Do NOT press the final Submit / Send application button. Stop on the review or submit step "
    "and report that the form is ready."
)
DO_SUBMIT = "You may now press the final Submit button once, then report the confirmation message."


class RunRequest(BaseModel):
    task: str
    files: list[str] = []
    max_steps: int = 60
    key: str | None = None
    allow_submit: bool = False


@dataclass
class Job:
    id: str
    key: str | None
    status: str = "running"
    steps: int = 0
    result: str | None = None
    reason: str | None = None
    started: float = field(default_factory=time.time)
    agent: Agent | None = None
    needs_human: str | None = None
    blocked_submit: str | None = None


app = FastAPI(title="jobagent browser service")
jobs: dict[str, Job] = {}
by_key: dict[str, str] = {}
run_lock = asyncio.Lock()


def check(token: str | None) -> None:
    if not TOKEN or not token or not hmac.compare_digest(token, TOKEN):
        raise HTTPException(401, "bad or missing X-Token")


def safe_files(files: list[str]) -> list[str]:
    out = []
    for f in files:
        p = Path(f)
        p = (DATA_DIR / p) if not p.is_absolute() else p
        p = p.resolve()
        if DATA_DIR not in p.parents or not p.is_file() or p.stat().st_size == 0:
            raise HTTPException(400, f"file must be a non-empty file inside data/: {f}")
        out.append(str(p))
    return out


def node_label(node) -> str:
    attrs = getattr(node, "attributes", None) or {}
    text = ""
    try:
        text = node.get_all_children_text(max_depth=2) or ""
    except Exception:
        pass
    return " ".join(
        str(x) for x in (text, attrs.get("value"), attrs.get("aria-label"), attrs.get("title")) if x
    ).strip()


def build_agent(job: Job, req: RunRequest, files: list[str]) -> Agent:
    tools = Tools()

    @tools.action("Ask the human for help (login, CAPTCHA, verification code, anything you cannot do). Ends the run.")
    async def ask_human(reason: str) -> ActionResult:
        job.needs_human = reason
        return ActionResult(is_done=True, success=False, extracted_content=f"Needs human: {reason}")

    async def on_step(state, output, step) -> None:
        """Runs after the model picked its actions and before they execute."""
        job.steps = step
        if req.allow_submit:
            return
        selector_map = getattr(getattr(state, "dom_state", None), "selector_map", {}) or {}
        for action in output.action:
            data = action.model_dump(exclude_unset=True)
            click = data.get("click") or data.get("click_element_by_index")
            index = click.get("index") if isinstance(click, dict) else None
            node = selector_map.get(index) if index is not None else None
            label = node_label(node) if node is not None else ""
            btn_type = str((getattr(node, "attributes", None) or {}).get("type", "")).lower()
            if label and (FINAL_SUBMIT.search(label) or (btn_type == "submit" and re.search(r"submit|send", label, re.I))):
                job.blocked_submit = label
                job.agent.stop()  # honoured before the actions run
                return

    # One path per line, exactly as the whitelist holds it (a list repr would double the backslashes).
    listed = "\n".join(files) if files else "none"
    task = f"{req.task}\n\nFiles you may upload (use these exact paths):\n{listed}"
    rules = RULES.format(submit_rule=DO_SUBMIT if req.allow_submit else NO_SUBMIT)
    api = dict(api_key=API_KEY)
    return Agent(
        task=task,
        llm=ChatGoogle(model=MODEL, thinking_level="low", **api),
        fallback_llm=ChatGoogle(model=FALLBACK_MODEL, **api),
        browser=Browser(cdp_url=CDP_URL, keep_alive=True),
        tools=tools,
        available_file_paths=files,
        extend_system_message=rules,
        register_new_step_callback=on_step,
        use_vision=True,
        flash_mode=True,
        use_judge=False,
        max_failures=4,
        llm_timeout=90,
        step_timeout=150,
    )


async def run_job(job: Job, req: RunRequest, files: list[str]) -> None:
    async with run_lock:
        try:
            job.agent = build_agent(job, req, files)
            history = await job.agent.run(max_steps=req.max_steps)
            job.steps = history.number_of_steps()
            job.result = history.final_result()
            if job.needs_human:
                job.status, job.reason = "needs_human", job.needs_human
            elif job.blocked_submit:
                job.status = "needs_submit_approval"
                job.reason = f'Stopped before pressing "{job.blocked_submit}".'
            elif history.is_done() and history.is_successful():
                job.status = "done"
            else:
                job.status = "failed"
                errs = [e for e in history.errors() if e]
                job.reason = (errs[-1] if errs else job.result or "run ended without finishing")[:500]
        except Exception as e:  # noqa: BLE001
            job.status, job.reason = "failed", f"{type(e).__name__}: {e}"[:500]
        finally:
            try:
                await job.agent.browser_session.stop()  # keep_alive: disconnects, leaves Chrome open
            except Exception:
                pass


async def chrome_up() -> bool:
    try:
        async with httpx.AsyncClient(timeout=2) as c:
            return (await c.get(f"{CDP_URL}/json/version")).status_code == 200
    except Exception:
        return False


@app.get("/health")
async def health() -> dict:
    return {"ok": True, "model": MODEL, "cdp": CDP_URL, "chrome": await chrome_up(), "busy": run_lock.locked()}


@app.post("/run")
async def run(req: RunRequest, x_token: str | None = Header(default=None)) -> dict:
    check(x_token)
    if req.key and req.key in by_key:
        return {"jobId": by_key[req.key]}
    if not API_KEY:
        raise HTTPException(500, "GEMINI_API_KEY is not set")
    if run_lock.locked():
        raise HTTPException(409, "another browser task is still running")
    if not await chrome_up():
        raise HTTPException(
            503, f"Chrome is not running with a debug port at {CDP_URL}. Run `npm run browser` again to reopen it."
        )
    files = safe_files(req.files)
    job = Job(id=uuid.uuid4().hex[:12], key=req.key)
    jobs[job.id] = job
    if req.key:
        by_key[req.key] = job.id
    asyncio.create_task(run_job(job, req, files))
    return {"jobId": job.id}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, x_token: str | None = Header(default=None)) -> dict:
    check(x_token)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return {
        "status": job.status,
        "steps": job.steps,
        "result": job.result,
        "reason": job.reason,
        "seconds": round(time.time() - job.started),
    }


@app.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str, x_token: str | None = Header(default=None)) -> dict:
    check(x_token)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    if job.agent and job.status == "running":
        job.agent.stop()
    return {"ok": True}

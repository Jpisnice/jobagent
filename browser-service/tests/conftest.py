"""Shared fixtures. The real browser-use Agent, Chrome and Gemini are never touched."""

import asyncio
import os
import sys
import time
from pathlib import Path

import pytest

# Must be set before server.py is imported (it reads these at import time).
os.environ["BROWSER_SERVICE_TOKEN"] = "test-token"
os.environ["GEMINI_API_KEY"] = "test-key"
os.environ["ANONYMIZED_TELEMETRY"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

AUTH = {"x-token": "test-token"}


class FakeHistory:
    def __init__(self, done=True, success=True, result="all good", errors=(), steps=3):
        self._done, self._success, self._result, self._errors, self._steps = done, success, result, list(errors), steps

    def is_done(self):
        return self._done

    def is_successful(self):
        return self._success

    def final_result(self):
        return self._result

    def errors(self):
        return self._errors

    def number_of_steps(self):
        return self._steps


class FakeSession:
    async def stop(self):
        pass


class FakeAgent:
    """Stands in for browser_use.Agent. `behaviour(job)` runs inside run() and returns a FakeHistory."""

    def __init__(self, job, behaviour):
        self.job, self.behaviour = job, behaviour
        self.browser_session = FakeSession()
        self.stopped = False

    async def run(self, max_steps=100):
        return await self.behaviour(self.job)

    def stop(self):
        self.stopped = True


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    d = tmp_path / "data"
    d.mkdir()
    monkeypatch.setattr(server, "DATA_DIR", d.resolve())
    return d


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    server.jobs.clear()
    server.by_key.clear()
    # A lock created on an earlier test's event loop can't be reused.
    monkeypatch.setattr(server, "run_lock", asyncio.Lock())

    async def chrome_up():
        return True

    monkeypatch.setattr(server, "chrome_up", chrome_up)


@pytest.fixture
def client():
    with TestClient(server.app) as c:
        yield c


@pytest.fixture
def use_behaviour(monkeypatch):
    """Make /run use a FakeAgent whose run() executes the given async behaviour(job)."""

    def install(behaviour):
        monkeypatch.setattr(server, "build_agent", lambda job, req, files: FakeAgent(job, behaviour))

    return install


def wait_for(client, job_id, timeout=5.0):
    """Poll a job until it leaves the running state."""
    end = time.time() + timeout
    while time.time() < end:
        body = client.get(f"/jobs/{job_id}", headers=AUTH).json()
        if body["status"] != "running":
            return body
        time.sleep(0.02)
    raise AssertionError("job still running")

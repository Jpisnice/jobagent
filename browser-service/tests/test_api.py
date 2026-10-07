"""HTTP API: auth, validation, job lifecycle and every final status."""

import asyncio

from conftest import AUTH, FakeHistory, wait_for

TASK = {"task": "Open the form and fill it in"}


class TestAuth:
    def test_health_is_open_and_reports_state(self, client):
        body = client.get("/health").json()
        assert body["ok"] is True and body["chrome"] is True and body["busy"] is False

    def test_run_requires_a_token(self, client):
        assert client.post("/run", json=TASK).status_code == 401

    def test_run_rejects_a_wrong_token(self, client):
        assert client.post("/run", json=TASK, headers={"x-token": "nope"}).status_code == 401

    def test_job_status_requires_a_token(self, client):
        assert client.get("/jobs/abc").status_code == 401

    def test_cancel_requires_a_token(self, client):
        assert client.post("/jobs/abc/cancel").status_code == 401


class TestRunValidation:
    def test_unknown_job_is_404(self, client):
        assert client.get("/jobs/missing", headers=AUTH).status_code == 404
        assert client.post("/jobs/missing/cancel", headers=AUTH).status_code == 404

    def test_missing_task_is_a_validation_error(self, client):
        assert client.post("/run", json={}, headers=AUTH).status_code == 422

    def test_503_with_a_helpful_message_when_chrome_is_not_running(self, client, monkeypatch):
        async def down():
            return False

        monkeypatch.setattr(server_module(), "chrome_up", down)
        r = client.post("/run", json=TASK, headers=AUTH)
        assert r.status_code == 503
        assert "npm run browser" in r.json()["detail"]

    def test_500_when_there_is_no_gemini_key(self, client, monkeypatch):
        monkeypatch.setattr(server_module(), "API_KEY", None)
        assert client.post("/run", json=TASK, headers=AUTH).status_code == 500

    def test_400_for_an_upload_outside_data(self, client, data_dir):
        r = client.post("/run", json={**TASK, "files": ["../package.json"]}, headers=AUTH)
        assert r.status_code == 400

    def test_400_for_a_missing_upload(self, client, data_dir):
        assert client.post("/run", json={**TASK, "files": ["resume.pdf"]}, headers=AUTH).status_code == 400


class TestLifecycle:
    def test_done(self, client, use_behaviour):
        async def ok(job):
            return FakeHistory(done=True, success=True, result="filled 9 fields", steps=5)

        use_behaviour(ok)
        job_id = client.post("/run", json=TASK, headers=AUTH).json()["jobId"]
        body = wait_for(client, job_id)
        assert body["status"] == "done"
        assert body["result"] == "filled 9 fields"
        assert body["steps"] == 5
        assert body["reason"] is None

    def test_failed_reports_the_last_error(self, client, use_behaviour):
        async def bad(job):
            return FakeHistory(done=False, success=False, result=None, errors=[None, "timeout on step 4"])

        use_behaviour(bad)
        body = wait_for(client, client.post("/run", json=TASK, headers=AUTH).json()["jobId"])
        assert body["status"] == "failed"
        assert body["reason"] == "timeout on step 4"

    def test_done_but_unsuccessful_counts_as_failed(self, client, use_behaviour):
        async def unsuccessful(job):
            return FakeHistory(done=True, success=False, result="could not find the form")

        use_behaviour(unsuccessful)
        body = wait_for(client, client.post("/run", json=TASK, headers=AUTH).json()["jobId"])
        assert body["status"] == "failed"
        assert "could not find the form" in body["reason"]

    def test_an_exception_becomes_a_failed_job_not_a_crash(self, client, use_behaviour):
        async def explode(job):
            raise RuntimeError("chrome went away")

        use_behaviour(explode)
        body = wait_for(client, client.post("/run", json=TASK, headers=AUTH).json()["jobId"])
        assert body["status"] == "failed"
        assert "RuntimeError: chrome went away" in body["reason"]

    def test_needs_human_wins_over_everything_else(self, client, use_behaviour):
        async def asks(job):
            job.needs_human = "Sign in, then reply done"
            return FakeHistory(done=True, success=False, result="Needs human: Sign in, then reply done")

        use_behaviour(asks)
        body = wait_for(client, client.post("/run", json=TASK, headers=AUTH).json()["jobId"])
        assert body["status"] == "needs_human"
        assert body["reason"] == "Sign in, then reply done"

    def test_blocked_submit_asks_for_approval(self, client, use_behaviour):
        async def blocked(job):
            job.blocked_submit = "Submit application"
            return FakeHistory(done=False, success=False, result=None)

        use_behaviour(blocked)
        body = wait_for(client, client.post("/run", json=TASK, headers=AUTH).json()["jobId"])
        assert body["status"] == "needs_submit_approval"
        assert "Submit application" in body["reason"]

    def test_data_file_is_passed_to_the_agent(self, client, data_dir, monkeypatch):
        (data_dir / "resume.pdf").write_bytes(b"%PDF")
        seen = {}

        def build(job, req, files):
            seen["files"] = files
            from conftest import FakeAgent

            async def ok(j):
                return FakeHistory()

            return FakeAgent(job, ok)

        monkeypatch.setattr(server_module(), "build_agent", build)
        wait_for(client, client.post("/run", json={**TASK, "files": ["resume.pdf"]}, headers=AUTH).json()["jobId"])
        assert seen["files"] == [str((data_dir / "resume.pdf").resolve())]


class TestIdempotencyAndConcurrency:
    def test_same_key_returns_the_same_job_and_does_not_start_another(self, client, use_behaviour):
        runs = []

        async def ok(job):
            runs.append(job.id)
            return FakeHistory()

        use_behaviour(ok)
        body = {**TASK, "key": "call-1"}
        first = client.post("/run", json=body, headers=AUTH).json()["jobId"]
        wait_for(client, first)
        again = client.post("/run", json=body, headers=AUTH).json()["jobId"]
        assert again == first
        assert runs == [first]

    def test_second_task_is_rejected_while_one_is_running(self, client, use_behaviour):
        release = {}

        async def slow(job):
            release["event"] = asyncio.Event()
            await release["event"].wait()
            return FakeHistory()

        use_behaviour(slow)
        first = client.post("/run", json={**TASK, "key": "a"}, headers=AUTH).json()["jobId"]
        # wait until the first job really holds the lock
        for _ in range(100):
            if client.get("/health").json()["busy"]:
                break
            import time

            time.sleep(0.02)
        assert client.post("/run", json={**TASK, "key": "b"}, headers=AUTH).status_code == 409
        assert client.get(f"/jobs/{first}", headers=AUTH).json()["status"] == "running"

    def test_cancel_stops_a_running_agent(self, client, use_behaviour):
        agents = []

        async def waits_for_stop(job):
            while not job.agent.stopped:
                await asyncio.sleep(0.01)
            return FakeHistory(done=False, success=False, result=None, errors=["stopped"])

        def build(job, req, files):
            from conftest import FakeAgent

            a = FakeAgent(job, waits_for_stop)
            agents.append(a)
            return a

        import pytest

        mp = pytest.MonkeyPatch()
        mp.setattr(server_module(), "build_agent", build)
        try:
            job_id = client.post("/run", json=TASK, headers=AUTH).json()["jobId"]
            for _ in range(100):
                if agents and client.get(f"/jobs/{job_id}", headers=AUTH).json()["status"] == "running":
                    break
            assert client.post(f"/jobs/{job_id}/cancel", headers=AUTH).json() == {"ok": True}
            body = wait_for(client, job_id)
            assert agents[0].stopped is True
            assert body["status"] == "failed"
        finally:
            mp.undo()


def server_module():
    import server

    return server

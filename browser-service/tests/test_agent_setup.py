"""build_agent wiring: the submit gate, the ask_human action and the prompt rules.

Agent/ChatGoogle/Browser are replaced with recorders, so nothing real starts.
"""

import asyncio
import types

import pytest

import server
from test_helpers import FakeNode


class Recorder:
    def __init__(self, **kw):
        self.kw = kw


@pytest.fixture
def built(monkeypatch):
    """Returns build(req) -> (kwargs the Agent was created with, job)."""
    captured = {}

    class FakeAgentCls:
        def __init__(self, **kw):
            captured.update(kw)
            self.stopped = False

        def stop(self):
            self.stopped = True

    monkeypatch.setattr(server, "Agent", FakeAgentCls)
    monkeypatch.setattr(server, "ChatGoogle", lambda **kw: Recorder(**kw))
    monkeypatch.setattr(server, "Browser", lambda **kw: Recorder(**kw))

    def build(**req_fields):
        captured.clear()
        req = server.RunRequest(task="fill the form", **req_fields)
        job = server.Job(id="j1", key=None)
        agent = server.build_agent(job, req, ["C:\\data\\resume.pdf"])
        job.agent = agent
        return dict(captured), job

    return build


def action(name, **fields):
    """A minimal stand-in for a browser-use ActionModel."""
    return types.SimpleNamespace(model_dump=lambda exclude_unset=True: {name: fields})


def state_with(nodes):
    return types.SimpleNamespace(dom_state=types.SimpleNamespace(selector_map=nodes))


def step(kw, nodes, *actions, number=1):
    out = types.SimpleNamespace(action=list(actions))
    asyncio.run(kw["register_new_step_callback"](state_with(nodes), out, number))


class TestAgentConfig:
    def test_attaches_to_the_local_chrome_and_keeps_it_open(self, built):
        kw, _ = built()
        assert kw["browser"].kw["cdp_url"] == server.CDP_URL
        assert kw["browser"].kw["keep_alive"] is True

    def test_uses_gemini_with_a_fallback_model(self, built):
        kw, _ = built()
        assert kw["llm"].kw["model"] == server.MODEL
        assert kw["llm"].kw["api_key"] == "test-key"
        assert kw["fallback_llm"].kw["model"] == server.FALLBACK_MODEL

    def test_only_the_given_files_may_be_uploaded(self, built):
        kw, _ = built()
        assert kw["available_file_paths"] == ["C:\\data\\resume.pdf"]
        assert "C:\\data\\resume.pdf" in kw["task"]

    def test_cost_and_runaway_guards_are_set(self, built):
        kw, _ = built()
        assert kw["use_judge"] is False
        assert kw["max_failures"] <= 5
        assert kw["llm_timeout"] and kw["step_timeout"]

    def test_ask_human_is_registered_as_an_action(self, built):
        kw, _ = built()
        assert "ask_human" in kw["tools"].registry.registry.actions

    def test_prompt_forbids_submitting_by_default(self, built):
        kw, _ = built()
        assert "Do NOT press the final Submit" in kw["extend_system_message"]

    def test_prompt_allows_one_submit_when_approved(self, built):
        kw, _ = built(allow_submit=True)
        assert "You may now press the final Submit button once" in kw["extend_system_message"]
        assert "Do NOT press the final Submit" not in kw["extend_system_message"]

    def test_checks_its_own_actions_instead_of_flash_mode(self, built, monkeypatch):
        monkeypatch.setattr(server, "FLASH", False)
        kw, _ = built()
        assert kw["flash_mode"] is False
        assert kw["use_thinking"] is False

    def test_flash_mode_can_be_turned_back_on(self, built, monkeypatch):
        monkeypatch.setattr(server, "FLASH", True)
        kw, _ = built()
        assert kw["flash_mode"] is True

    def test_model_sees_selection_state_of_custom_buttons(self, built):
        kw, _ = built()
        for attr in ("checked", "aria-checked", "aria-pressed", "aria-selected", "aria-haspopup"):
            assert attr in kw["include_attributes"]

    def test_form_actions_are_registered(self, built):
        kw, _ = built()
        actions = kw["tools"].registry.registry.actions
        assert "choose_option" in actions and "choose_choice" in actions

    def test_form_actions_end_the_step_so_later_indexes_are_not_stale(self, built):
        kw, _ = built()
        actions = kw["tools"].registry.registry.actions
        assert actions["choose_option"].terminates_sequence is True
        assert actions["choose_choice"].terminates_sequence is True

    def test_prompt_routes_dropdowns_and_choices_to_the_form_actions(self, built):
        kw, _ = built()
        rules = kw["extend_system_message"]
        assert "choose_option" in rules and "choose_choice" in rules
        assert "Never click a choice twice" in rules

    def test_prompt_never_lets_the_agent_type_passwords(self, built):
        kw, _ = built()
        assert "password" in kw["extend_system_message"].lower()
        assert "ask_human" in kw["extend_system_message"]


class TestSubmitGate:
    def test_blocks_a_click_on_the_final_submit_button(self, built):
        kw, job = built()
        step(kw, {7: FakeNode("Submit application")}, action("click", index=7))
        assert job.blocked_submit == "Submit application"
        assert job.agent.stopped is True

    def test_blocks_a_submit_type_button_labelled_send(self, built):
        kw, job = built()
        step(kw, {3: FakeNode("Send my details", type="submit")}, action("click", index=3))
        assert job.blocked_submit
        assert job.agent.stopped is True

    def test_does_not_block_a_normal_next_button(self, built):
        kw, job = built()
        step(kw, {2: FakeNode("Next step")}, action("click", index=2))
        assert job.blocked_submit is None
        assert job.agent.stopped is False

    def test_does_not_block_the_apply_button_that_starts_the_flow(self, built):
        kw, job = built()
        step(kw, {4: FakeNode("Apply for this job")}, action("click", index=4))
        assert job.blocked_submit is None

    def test_a_submit_hidden_in_a_batch_of_actions_is_still_caught(self, built):
        kw, job = built()
        nodes = {1: FakeNode("Phone"), 9: FakeNode("Submit application")}
        step(kw, nodes, action("input", index=1, text="123"), action("click", index=9))
        assert job.blocked_submit == "Submit application"
        assert job.agent.stopped is True

    @pytest.mark.parametrize("name", ["choose_option", "choose_choice"])
    def test_form_actions_on_the_submit_button_are_blocked(self, built, name):
        kw, job = built()
        step(kw, {7: FakeNode("Submit application")}, action(name, index=7, value="Yes"))
        assert job.blocked_submit == "Submit application"
        assert job.agent.stopped is True

    def test_non_click_actions_never_block(self, built):
        kw, job = built()
        step(kw, {5: FakeNode("Submit application")}, action("input", index=5, text="x"))
        assert job.blocked_submit is None

    def test_a_click_on_an_unknown_index_does_not_crash(self, built):
        kw, job = built()
        step(kw, {}, action("click", index=99))
        assert job.blocked_submit is None

    def test_allowed_submit_goes_through(self, built):
        kw, job = built(allow_submit=True)
        step(kw, {7: FakeNode("Submit application")}, action("click", index=7))
        assert job.blocked_submit is None
        assert job.agent.stopped is False

    def test_records_the_step_number(self, built):
        kw, job = built()
        step(kw, {}, action("scroll", down=True), number=6)
        assert job.steps == 6

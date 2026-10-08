"""Pure helpers: token check, upload path guard, element labels, final-submit detection."""

import pytest
from fastapi import HTTPException

import server


class TestCheck:
    def test_accepts_the_right_token(self):
        server.check("test-token")

    @pytest.mark.parametrize("bad", [None, "", "wrong", "test-token "])
    def test_rejects_missing_or_wrong_token(self, bad):
        with pytest.raises(HTTPException) as e:
            server.check(bad)
        assert e.value.status_code == 401

    def test_rejects_everything_when_no_token_is_configured(self, monkeypatch):
        monkeypatch.setattr(server, "TOKEN", None)
        with pytest.raises(HTTPException):
            server.check("test-token")


class TestSafeFiles:
    def test_resolves_a_name_inside_data(self, data_dir):
        (data_dir / "resume.pdf").write_bytes(b"%PDF-1.4 content")
        assert server.safe_files(["resume.pdf"]) == [str((data_dir / "resume.pdf").resolve())]

    def test_accepts_an_absolute_path_inside_data(self, data_dir):
        f = data_dir / "cv.pdf"
        f.write_bytes(b"x")
        assert server.safe_files([str(f)]) == [str(f.resolve())]

    def test_no_files_is_fine(self, data_dir):
        assert server.safe_files([]) == []

    @pytest.mark.parametrize("name", ["../secret.txt", "..\\secret.txt", "sub/../../secret.txt"])
    def test_blocks_traversal_out_of_data(self, data_dir, name):
        (data_dir.parent / "secret.txt").write_bytes(b"top secret")
        with pytest.raises(HTTPException) as e:
            server.safe_files([name])
        assert e.value.status_code == 400

    def test_blocks_absolute_path_outside_data(self, data_dir, tmp_path):
        outside = tmp_path / "outside.pdf"
        outside.write_bytes(b"x")
        with pytest.raises(HTTPException):
            server.safe_files([str(outside)])

    def test_blocks_missing_file(self, data_dir):
        with pytest.raises(HTTPException):
            server.safe_files(["nope.pdf"])

    def test_blocks_empty_file(self, data_dir):
        (data_dir / "empty.pdf").write_bytes(b"")
        with pytest.raises(HTTPException):
            server.safe_files(["empty.pdf"])

    def test_blocks_a_directory(self, data_dir):
        (data_dir / "folder").mkdir()
        with pytest.raises(HTTPException):
            server.safe_files(["folder"])


class FakeNode:
    def __init__(self, text="", **attributes):
        self._text, self.attributes = text, attributes

    def get_all_children_text(self, max_depth=2):
        return self._text


class TestNodeLabel:
    def test_combines_text_value_aria_label_and_title(self):
        node = FakeNode("Submit", value="go", **{"aria-label": "Send it", "title": "tip"})
        assert server.node_label(node) == "Submit go Send it tip"

    def test_empty_node_gives_empty_label(self):
        assert server.node_label(FakeNode()) == ""

    def test_survives_a_node_that_cannot_read_children(self):
        class Broken(FakeNode):
            def get_all_children_text(self, max_depth=2):
                raise RuntimeError("boom")

        assert server.node_label(Broken(value="Submit")) == "Submit"


class TestFinalSubmitPattern:
    @pytest.mark.parametrize(
        "label",
        [
            "Submit",
            "submit application",
            "Submit your application",
            "Send application",
            "Complete application",
            "Finish application",
            "Confirm and submit",
            "SUBMIT APPLICATION",
        ],
    )
    def test_matches_buttons_that_really_send_the_application(self, label):
        assert server.FINAL_SUBMIT.search(label)

    @pytest.mark.parametrize(
        "label",
        ["Apply for this job", "Apply now", "Next step", "Continue", "Back", "Upload resume", "Save draft", "Sign in"],
    )
    def test_does_not_match_buttons_that_only_move_the_flow_along(self, label):
        assert not server.FINAL_SUBMIT.search(label)


class TestIsFinalSubmit:
    def test_a_submit_type_button_that_mentions_submit(self):
        assert server.is_final_submit("Review and submit", "submit")

    def test_type_is_case_insensitive(self):
        assert server.is_final_submit("Review and submit", "SUBMIT")

    def test_the_label_pattern_alone_is_enough(self):
        assert server.is_final_submit("Submit application", "button")

    def test_a_submit_type_button_that_only_moves_on(self):
        assert not server.is_final_submit("Next", "submit")

    def test_empty_label_never_counts(self):
        assert not server.is_final_submit("", "submit")

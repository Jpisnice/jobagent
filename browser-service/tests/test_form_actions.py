"""Option matching for choose_option / choose_choice. The page scripts are checked by hand in Chrome."""

import pytest

from form_actions import match_option


class TestMatchOption:
    def test_exact_text_wins(self):
        assert match_option(["Canada", "Canada (French)"], "Canada") == 0

    def test_ignores_case_and_spacing(self):
        assert match_option(["United  States", "Canada"], "united states") == 0

    def test_exact_beats_an_earlier_partial_match(self):
        assert match_option(["United States Minor Outlying Islands", "United States"], "United States") == 1

    def test_option_starting_with_the_value(self):
        assert match_option(["Mexico", "United States of America"], "United States") == 1

    def test_value_as_whole_words_inside_an_option(self):
        assert match_option(["Prefer not to say", "I am a protected veteran"], "protected veteran") == 1

    def test_no_does_not_match_words_that_start_with_no(self):
        assert match_option(["Not applicable", "None", "Yes"], "No") is None

    def test_long_answer_matches_a_short_option(self):
        assert match_option(["Yes", "No"], "Yes, I am authorized to work in the US") == 0

    @pytest.mark.parametrize("value", ["", "   "])
    def test_empty_value_matches_nothing(self, value):
        assert match_option(["Yes", "No"], value) is None

    def test_no_match_gives_none(self):
        assert match_option(["Red", "Green"], "Blue") is None

    def test_blank_options_are_skipped(self):
        assert match_option(["", "Select...", "Yes"], "yes") == 2

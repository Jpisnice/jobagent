"""Matching and read-back decisions for choose_option / choose_choice.

The page scripts themselves are exercised by hand in Chrome.
"""

import pytest

from form_actions import match_option, match_options, no_match_message, option_took


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

    def test_long_answer_matches_the_option_it_starts_with(self):
        assert match_option(["Yes", "No"], "Yes, I am authorized to work in the US") == 0

    def test_a_later_no_in_the_answer_does_not_beat_its_leading_yes(self):
        assert match_option(["No", "Yes"], "Yes, I am authorized and need no sponsorship") == 1

    @pytest.mark.parametrize("value", ["", "   "])
    def test_empty_value_matches_nothing(self, value):
        assert match_option(["Yes", "No"], value) is None

    def test_no_match_gives_none(self):
        assert match_option(["Red", "Green"], "Blue") is None

    def test_blank_options_are_skipped(self):
        assert match_option(["", "Select...", "Yes"], "yes") == 2

    def test_duplicate_texts_are_not_ambiguous(self):
        assert match_option(["LinkedIn", "LinkedIn"], "LinkedIn") == 0


class TestAmbiguity:
    def test_two_options_containing_the_value_are_ambiguous(self):
        options = ["I am a protected veteran", "I am not a protected veteran"]
        assert match_option(options, "protected veteran") is None
        assert match_options(options, "protected veteran") == [0, 1]

    def test_an_answer_mentioning_both_options_is_ambiguous(self):
        assert match_option(["Yes", "No"], "I need no visa, yes") is None

    def test_message_lists_the_candidates(self):
        msg = no_match_message(["I am a protected veteran", "I am not a protected veteran", "Decline"], "protected veteran", "option")
        assert "could mean more than one option" in msg
        assert "I am not a protected veteran" in msg and "Decline" not in msg

    def test_message_lists_the_real_options_when_nothing_matches(self):
        msg = no_match_message(["LinkedIn", "Indeed", "LinkedIn", ""], "Twitter", "option")
        assert "No option matches" in msg
        assert "LinkedIn; Indeed." in msg


class TestOptionTook:
    def test_visible_select_with_the_option(self):
        assert option_took({"value": "Canada", "hidden": False}, "Canada", "select", "") == (True, "Canada")

    def test_visible_select_with_another_option(self):
        assert option_took({"value": "Select...", "hidden": False}, "Canada", "select", "")[0] is False

    def test_hidden_select_needs_the_visible_widget_to_agree(self):
        read = {"value": "Canada", "hidden": True, "widget": "Select a country"}
        assert option_took(read, "Canada", "select", "") == (False, "Select a country")

    def test_hidden_select_whose_widget_updated(self):
        read = {"value": "Canada", "hidden": True, "widget": "Canada ×"}
        assert option_took(read, "Canada", "select", "")[0] is True

    def test_combobox_showing_the_option(self):
        read = {"box": "LinkedIn", "input": "", "menuOpen": False}
        assert option_took(read, "LinkedIn", "search", "LinkedIn") == (True, "LinkedIn")

    def test_our_own_typing_is_not_a_pick_while_the_menu_is_still_open(self):
        read = {"box": "Select...", "input": "United States", "menuOpen": True}
        assert option_took(read, "United States", "search", "United States")[0] is False

    def test_autocomplete_that_put_the_option_in_the_input(self):
        read = {"box": "", "input": "Toronto, ON, Canada", "menuOpen": False}
        assert option_took(read, "Toronto, ON, Canada", "search", "Toronto")[0] is True

    def test_short_answers_need_whole_words(self):
        read = {"box": "Do you know anyone at the company? Select...", "input": "", "menuOpen": True}
        assert option_took(read, "No", "list", "")[0] is False

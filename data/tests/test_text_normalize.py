"""Tests for etl/growing_info/text_normalize.py (backlog #119)."""

from etl.growing_info.text_normalize import clean_fragment, reflow_paragraphs, reflow_stored_text


class TestCleanFragment:
    def test_collapses_embedded_crlf_line_wraps(self) -> None:
        assert clean_fragment("The bean is a\r\nvery hardy plant.") == "The bean is a very hardy plant."

    def test_collapses_multiple_whitespace_runs(self) -> None:
        assert clean_fragment("Too   many    spaces.") == "Too many spaces."

    def test_collapses_tabs_and_mixed_whitespace(self) -> None:
        assert clean_fragment("Tab\there\tand\r\nnewline.") == "Tab here and newline."

    def test_strips_leading_and_trailing_whitespace(self) -> None:
        assert clean_fragment("  \r\n  Padded text.  \n\n  ") == "Padded text."

    def test_leaves_already_clean_text_unchanged(self) -> None:
        assert clean_fragment("Clean prose, no artifacts.") == "Clean prose, no artifacts."


class TestReflowParagraphs:
    def test_fragments_ending_in_terminal_punctuation_become_separate_paragraphs(self) -> None:
        result = reflow_paragraphs(["First real paragraph.", "Second real paragraph."])
        assert result == "First real paragraph.\n\nSecond real paragraph."

    def test_fragments_not_ending_in_terminal_punctuation_are_merged_mid_sentence(self) -> None:
        """The per-line-tagged-book case (#43531): each <p> is one printed
        line, not a real paragraph, so consecutive line-fragments that don't
        end a sentence must reflow back into one paragraph."""
        result = reflow_paragraphs(["The common bean", "is a tender annual", "grown for its pods."])
        assert result == "The common bean is a tender annual grown for its pods."

    def test_mix_of_line_wrapped_and_real_paragraph_fragments(self) -> None:
        result = reflow_paragraphs(
            [
                "Beans need full sun",
                "and rich, well-drained soil.",
                "Sow after the last frost date.",
            ]
        )
        assert result == "Beans need full sun and rich, well-drained soil.\n\nSow after the last frost date."

    def test_trailing_page_marker_does_not_count_as_a_real_sentence_end(self) -> None:
        """A bracketed page-number artifact like '[130]' tacked onto a
        fragment with no real terminal punctuation must not be mistaken for
        a paragraph break."""
        result = reflow_paragraphs(["as described high above [130]", "in the garden plan."])
        assert result == "as described high above [130] in the garden plan."

    def test_real_terminal_punctuation_followed_by_a_page_marker_still_splits(self) -> None:
        result = reflow_paragraphs(["Plant them highly. [15]", "Water regularly."])
        assert result == "Plant them highly. [15]\n\nWater regularly."

    def test_sentence_ending_in_a_closing_quote_or_paren_is_recognized(self) -> None:
        result = reflow_paragraphs(['He wrote "stop watering!"', "The next chapter begins."])
        assert result == 'He wrote "stop watering!"\n\nThe next chapter begins.'

    def test_embedded_crlf_within_a_fragment_is_cleaned_before_the_paragraph_check(self) -> None:
        result = reflow_paragraphs(["The bean is a\r\nvery hardy plant.", "It grows quickly."])
        assert result == "The bean is a very hardy plant.\n\nIt grows quickly."

    def test_empty_and_whitespace_only_fragments_are_skipped(self) -> None:
        result = reflow_paragraphs(["First paragraph.", "   ", "", "Second paragraph."])
        assert result == "First paragraph.\n\nSecond paragraph."

    def test_single_fragment(self) -> None:
        assert reflow_paragraphs(["Only one paragraph here."]) == "Only one paragraph here."

    def test_empty_input_produces_empty_string(self) -> None:
        assert reflow_paragraphs([]) == ""
        assert reflow_paragraphs(["", "   "]) == ""

    def test_final_unterminated_fragment_is_still_included(self) -> None:
        """A trailing fragment with no terminal punctuation at all (e.g. an
        abrupt/incomplete final line) must still appear in the output, not
        be silently dropped."""
        result = reflow_paragraphs(["Complete sentence.", "an incomplete trailing fragment"])
        assert result == "Complete sentence.\n\nan incomplete trailing fragment"


class TestReflowStoredText:
    def test_reflows_previously_mis_joined_text(self) -> None:
        """Simulates the old buggy join's output for a per-line-tagged book:
        every original <p> fragment separated by a literal '\\n\\n', most of
        which were really mid-sentence breaks."""
        stored = "The common bean\n\nis a tender annual\n\ngrown for its pods.\n\nSow after frost."
        assert reflow_stored_text(stored) == (
            "The common bean is a tender annual grown for its pods.\n\nSow after frost."
        )

    def test_is_idempotent_on_already_clean_text_with_real_paragraph_breaks(self) -> None:
        clean = "First real paragraph, ending properly.\n\nSecond real paragraph, also ending properly."
        assert reflow_stored_text(clean) == clean

    def test_running_reflow_paragraphs_twice_on_its_own_output_is_a_no_op(self) -> None:
        fragments = ["The common bean", "is a tender annual", "grown for its pods."]
        once = reflow_paragraphs(fragments)
        twice = reflow_paragraphs(once.split("\n\n"))
        assert once == twice

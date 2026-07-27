"""Tests for etl/sources/wikipedia_companions.py's citation-marker cleanup
(GitHub issue #151: leftover "[6]"-style Wikipedia reference markers leaking
into pest_or_insect values)."""

from etl.sources.wikipedia_companions import _split_names


class TestSplitNames:
    def test_empty_or_placeholder_cell_returns_empty_list(self) -> None:
        assert _split_names("") == []
        assert _split_names("-") == []
        assert _split_names("none") == []

    def test_plain_comma_separated_names_unaffected(self) -> None:
        assert _split_names("aphids, whiteflies") == ["aphids", "whiteflies"]

    def test_and_separated_names_unaffected(self) -> None:
        assert _split_names("slugs and snails") == ["slugs", "snails"]

    def test_strips_trailing_citation_marker(self) -> None:
        assert _split_names("hummingbirds [ 85 ]") == ["hummingbirds"]

    def test_strips_leading_citation_marker(self) -> None:
        assert _split_names("[ 6 ] mosquitoes") == ["mosquitoes"]

    def test_strips_multiple_citation_markers_on_one_name(self) -> None:
        assert _split_names("[ 6 ] [ 28 ] cabbage weevil") == ["cabbage weevil"]

    def test_citation_marker_with_no_name_left_is_dropped(self) -> None:
        assert _split_names("[ 65 ]") == []

    def test_sentence_ending_citation_glued_to_next_item_is_split(self) -> None:
        """The real basil.json case: 'Slugs and snails.[39] butterflies' has
        no comma between 'snails' and 'butterflies', just a citation marker
        - must still come out as two separate pest names, not one mangled
        string."""
        assert _split_names("Slugs and snails.[39] butterflies") == ["Slugs", "snails", "butterflies"]

    def test_period_citation_at_end_of_cell_has_no_dangling_period(self) -> None:
        assert _split_names("snails.[39]") == ["snails"]

    def test_citation_with_internal_spacing_variants(self) -> None:
        assert _split_names("aphids[65]") == ["aphids"]
        assert _split_names("aphids [65]") == ["aphids"]
        assert _split_names("aphids [ 65 ]") == ["aphids"]

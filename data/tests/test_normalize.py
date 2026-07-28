"""Tests for etl/normalize.py's title_case_plant_name (GitHub issue #161:
acronym and apostrophe-proper-noun edge cases, on top of the earlier fixes
for leading punctuation and words after an internal slash)."""

from etl.normalize import map_sun_level, title_case_plant_name


class TestTitleCasePlantName:
    def test_basic_title_casing(self) -> None:
        assert title_case_plant_name("bitter orange") == "Bitter Orange"

    def test_connector_words_stay_lowercase_when_not_first(self) -> None:
        assert title_case_plant_name("rose of sharon") == "Rose of Sharon"

    def test_apostrophe_possessive_stays_lowercase(self) -> None:
        assert title_case_plant_name("bishop's cap") == "Bishop's Cap"

    def test_leading_punctuation_is_still_capitalized_correctly(self) -> None:
        assert title_case_plant_name("Holy Basil (tulsi)") == "Holy Basil (Tulsi)"

    def test_word_after_internal_slash_is_capitalized(self) -> None:
        assert title_case_plant_name("Melon (Honeydew/specialty)") == "Melon (Honeydew/Specialty)"

    def test_hyphenated_cultivar_name(self) -> None:
        assert title_case_plant_name("wai-iti taewa potato") == "Wai-Iti Taewa Potato"

    def test_acronym_sfg_preserved_uppercase(self) -> None:
        assert title_case_plant_name("Bonnie Bell Sweet Pepper sfg") == "Bonnie Bell Sweet Pepper SFG"

    def test_acronym_uf_preserved_uppercase(self) -> None:
        assert title_case_plant_name("uf micro tom tomato") == "UF Micro Tom Tomato"

    def test_apostrophe_proper_noun_anjou_capitalized(self) -> None:
        assert title_case_plant_name("Red D'anjou Pear") == "Red D'Anjou Pear"

    def test_apostrophe_proper_noun_from_all_lowercase_source(self) -> None:
        assert title_case_plant_name("red d'anjou pear") == "Red D'Anjou Pear"

    def test_empty_string_returns_unchanged(self) -> None:
        assert title_case_plant_name("") == ""

    def test_idempotent_on_already_correct_input(self) -> None:
        already_correct = "Bonnie Bell Sweet Pepper SFG"
        assert title_case_plant_name(already_correct) == already_correct
        already_correct_anjou = "Red D'Anjou Pear"
        assert title_case_plant_name(already_correct_anjou) == already_correct_anjou


class TestMapSunLevel:
    """GitHub issue #186: homesteader-labs' raw crop data uses the bare
    string 'partial' (not 'partial shade'/'partial sun'/'part shade'/
    'part sun') for some plants (e.g. parsley), which _SUN_MAP didn't
    recognize - map_sun_level() silently returned None, dropping that
    source's contribution to sun_level without ever registering as a
    conflict against another source's (possibly wrong) value."""

    def test_bare_partial_maps_to_half_sun(self) -> None:
        assert map_sun_level("partial") == "half_sun"

    def test_bare_partial_is_case_insensitive(self) -> None:
        assert map_sun_level("Partial") == "half_sun"

    def test_full_still_maps_to_full_sun(self) -> None:
        assert map_sun_level("full") == "full_sun"

    def test_unrecognized_text_returns_none(self) -> None:
        assert map_sun_level("dappled") is None

    def test_none_input_returns_none(self) -> None:
        assert map_sun_level(None) is None

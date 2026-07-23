"""Tests for etl/growing_info/state.py's per-plant-pass checkpointing -
directly relevant to #120's fix (run.py must NOT call mark_pass_done when
consolidate_pass raises ConsolidationFailed, so a later run retries it).
Uses a throwaway sqlite file via tmp_path, never the real
data/.state/growing_info.db."""

import pytest

from etl.growing_info import state


@pytest.fixture()
def isolated_state_db(tmp_path, monkeypatch: pytest.MonkeyPatch):
    db_path = tmp_path / "growing_info_test.db"
    monkeypatch.setattr(state, "STATE_DB", db_path)
    state.init_db()
    return db_path


def test_a_pass_is_not_done_until_explicitly_marked(isolated_state_db) -> None:
    assert state.is_pass_done("test-plant", "consolidate") is False


def test_marking_a_pass_done_persists_it(isolated_state_db) -> None:
    state.mark_pass_done("test-plant", "consolidate")
    assert state.is_pass_done("test-plant", "consolidate") is True


def test_pass_checkpoints_are_independent_per_plant_and_per_pass(isolated_state_db) -> None:
    state.mark_pass_done("test-tomato", "consolidate")
    assert state.is_pass_done("test-tomato", "consolidate") is True
    assert state.is_pass_done("test-tomato", "extract") is False
    assert state.is_pass_done("test-potato", "consolidate") is False


def test_a_failed_pass_never_marked_done_is_retried_the_next_run(isolated_state_db) -> None:
    """Directly models #120's own fix: consolidate_pass raising
    ConsolidationFailed means run.py's try/except never reaches
    mark_pass_done - simulated here by simply never calling it for a
    "failed" plant - and the checkpoint correctly still reads as not-done,
    so a subsequent run_passes invocation would retry it."""
    state.mark_pass_done("test-tomato", "consolidate")  # a different plant succeeded
    # "test-celery" never gets mark_pass_done called - simulating the
    # ConsolidationFailed path.
    assert state.is_pass_done("test-celery", "consolidate") is False
    assert state.is_pass_done("test-tomato", "consolidate") is True


def test_reset_pass_done_un_checkpoints_a_specific_pass_only(isolated_state_db) -> None:
    state.mark_pass_done("test-tomato", "consolidate")
    state.mark_pass_done("test-tomato", "extract")

    state.reset_pass_done("test-tomato", "consolidate")

    assert state.is_pass_done("test-tomato", "consolidate") is False
    assert state.is_pass_done("test-tomato", "extract") is True  # untouched


def test_marking_a_pass_done_twice_is_idempotent(isolated_state_db) -> None:
    state.mark_pass_done("test-tomato", "consolidate")
    state.mark_pass_done("test-tomato", "consolidate")  # INSERT OR REPLACE - must not raise
    assert state.is_pass_done("test-tomato", "consolidate") is True


def test_unknown_pass_name_is_rejected(isolated_state_db) -> None:
    with pytest.raises(AssertionError):
        state.is_pass_done("test-tomato", "not-a-real-pass")
    with pytest.raises(AssertionError):
        state.mark_pass_done("test-tomato", "not-a-real-pass")

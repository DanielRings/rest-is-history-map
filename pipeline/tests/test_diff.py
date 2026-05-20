"""Unit tests for ``pipeline.diff``: stub writing and idempotency."""

from __future__ import annotations

from pathlib import Path

import yaml

from pipeline.diff import diff_and_write_stubs
from pipeline.fetch import fetch_raw_episodes

REPO_ROOT = Path(__file__).resolve().parents[2]
RSS_SAMPLE = REPO_ROOT / "data" / "samples" / "rss.sample.xml"


def test_diff_writes_thirteen_stubs_into_empty_directory(tmp_path: Path) -> None:
    episodes_dir = tmp_path / "episodes"
    pending_dir = tmp_path / "pending"
    episodes_dir.mkdir()

    raw = fetch_raw_episodes(str(RSS_SAMPLE))
    new_guids = diff_and_write_stubs(raw, episodes_dir, pending_dir)

    assert len(new_guids) == 13
    written = sorted(p.name for p in pending_dir.glob("*.yaml"))
    assert len(written) == 13
    assert "sample-bonus-saturnalia.yaml" in written


def test_diff_is_idempotent_on_repeat_run(tmp_path: Path) -> None:
    episodes_dir = tmp_path / "episodes"
    pending_dir = tmp_path / "pending"
    episodes_dir.mkdir()
    raw = fetch_raw_episodes(str(RSS_SAMPLE))

    first = diff_and_write_stubs(raw, episodes_dir, pending_dir)
    second = diff_and_write_stubs(raw, episodes_dir, pending_dir)

    assert len(first) == 13
    assert second == []


def test_diff_skips_already_tagged_episodes(tmp_path: Path) -> None:
    episodes_dir = tmp_path / "episodes"
    pending_dir = tmp_path / "pending"
    episodes_dir.mkdir()
    # Pretend the user already tagged the bonus episode.
    (episodes_dir / "sample-bonus-saturnalia.yaml").write_text("guid: sample-bonus-saturnalia\n")

    raw = fetch_raw_episodes(str(RSS_SAMPLE))
    new_guids = diff_and_write_stubs(raw, episodes_dir, pending_dir)

    assert "sample-bonus-saturnalia" not in new_guids
    assert not (pending_dir / "sample-bonus-saturnalia.yaml").exists()
    assert len(new_guids) == 12


def test_diff_stub_marks_bonus_as_members_and_full_as_public(tmp_path: Path) -> None:
    episodes_dir = tmp_path / "episodes"
    pending_dir = tmp_path / "pending"
    episodes_dir.mkdir()
    raw = fetch_raw_episodes(str(RSS_SAMPLE))
    diff_and_write_stubs(raw, episodes_dir, pending_dir)

    bonus = yaml.safe_load((pending_dir / "sample-bonus-saturnalia.yaml").read_text())
    regular = yaml.safe_load((pending_dir / "sample-caesar-ides.yaml").read_text())

    assert bonus["access"] == "members"
    assert regular["access"] == "public"
    # Tagging fields are left blank for the human to fill in.
    for stub in (bonus, regular):
        assert stub["countries"] == []
        assert stub["year_start"] is None
        assert stub["year_end"] is None
        assert stub["date_precision"] is None
        assert stub["kind"] is None
        assert stub["topics"] == []
        assert stub["historical_figures"] == []
        assert stub["links"] == {}

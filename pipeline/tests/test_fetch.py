"""Unit tests for ``pipeline.fetch`` against the offline RSS sample."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from pipeline.fetch import fetch_from_env, fetch_raw_episodes

REPO_ROOT = Path(__file__).resolve().parents[2]
RSS_SAMPLE = REPO_ROOT / "data" / "samples" / "rss.sample.xml"
EPISODES_SAMPLE = REPO_ROOT / "data" / "samples" / "episodes.sample.json"

ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _sample_guids() -> set[str]:
    with EPISODES_SAMPLE.open(encoding="utf-8") as handle:
        sample = json.load(handle)
    return {ep["guid"] for ep in sample["episodes"]}


def test_fetch_round_trips_all_thirteen_guids() -> None:
    episodes = fetch_raw_episodes(str(RSS_SAMPLE))
    assert len(episodes) == 13
    fetched_guids = {ep["guid"] for ep in episodes}
    assert fetched_guids == _sample_guids()


def test_fetch_pub_dates_are_iso_utc_with_z_suffix() -> None:
    episodes = fetch_raw_episodes(str(RSS_SAMPLE))
    for ep in episodes:
        assert ISO_Z.match(ep["pub_date"]), ep["pub_date"]


def test_fetch_audio_urls_present_and_unique() -> None:
    episodes = fetch_raw_episodes(str(RSS_SAMPLE))
    urls = [ep["audio_url"] for ep in episodes]
    assert all(url.startswith("https://") for url in urls)
    assert len(set(urls)) == len(urls)


def test_fetch_marks_bonus_episode_type() -> None:
    episodes = fetch_raw_episodes(str(RSS_SAMPLE))
    by_guid = {ep["guid"]: ep for ep in episodes}
    assert by_guid["sample-bonus-saturnalia"]["episode_type"] == "bonus"
    for guid, ep in by_guid.items():
        if guid != "sample-bonus-saturnalia":
            assert ep["episode_type"] == "full"


def test_fetch_titles_and_descriptions_nonempty() -> None:
    episodes = fetch_raw_episodes(str(RSS_SAMPLE))
    for ep in episodes:
        assert ep["title"]
        assert ep["description"]


def test_fetch_from_env_requires_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RIH_RSS_URL", raising=False)
    with pytest.raises(RuntimeError, match="RIH_RSS_URL"):
        fetch_from_env()


def test_fetch_from_env_uses_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RIH_RSS_URL", str(RSS_SAMPLE))
    episodes = fetch_from_env()
    assert len(episodes) == 13

"""End-to-end pipeline test: assemble W0 sample YAMLs and emit matching JSON."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pipeline.assemble import assemble_episodes
from pipeline.emit import emit

REPO_ROOT = Path(__file__).resolve().parents[2]
EPISODES_DIR = REPO_ROOT / "data" / "episodes"
EXPECTED_PATH = REPO_ROOT / "data" / "samples" / "episodes.sample.json"


def _by_guid(episodes: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {ep["guid"]: ep for ep in episodes}


def test_build_matches_sample_modulo_generated_at(tmp_path: Path) -> None:
    episodes = assemble_episodes(EPISODES_DIR)
    out_path = tmp_path / "episodes.json"
    doc = emit(episodes, out_path)

    with EXPECTED_PATH.open(encoding="utf-8") as handle:
        expected = json.load(handle)
    with out_path.open(encoding="utf-8") as handle:
        actual = json.load(handle)

    # generated_at is non-deterministic by design — drop it before comparing.
    expected.pop("generated_at")
    actual.pop("generated_at")
    doc.pop("generated_at")

    assert actual["version"] == expected["version"] == 1
    assert _by_guid(actual["episodes"]) == _by_guid(expected["episodes"])
    # Sanity: the emit return value also matches what landed on disk.
    assert _by_guid(doc["episodes"]) == _by_guid(actual["episodes"])


def test_build_produces_thirteen_episodes() -> None:
    episodes = assemble_episodes(EPISODES_DIR)
    assert len(episodes) == 13
    guids = {ep["guid"] for ep in episodes}
    with EXPECTED_PATH.open(encoding="utf-8") as handle:
        expected_guids = {ep["guid"] for ep in json.load(handle)["episodes"]}
    assert guids == expected_guids

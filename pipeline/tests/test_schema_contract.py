"""Contract tests: the W0 sample fixture must validate against the schema.

These tests guard the producer/consumer contract. If they fail, the schema or
the fixture is wrong and both sides must be updated together.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = REPO_ROOT / "schema" / "episodes.schema.json"
SAMPLE_PATH = REPO_ROOT / "data" / "samples" / "episodes.sample.json"


def _load_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    assert isinstance(data, dict), f"{path} should be a JSON object"
    return data


def test_sample_fixture_validates_against_schema() -> None:
    """data/samples/episodes.sample.json conforms to schema/episodes.schema.json."""
    schema = _load_json(SCHEMA_PATH)
    sample = _load_json(SAMPLE_PATH)
    jsonschema.validate(instance=sample, schema=schema)


def test_sample_fixture_covers_all_kinds() -> None:
    """The fixture must exercise every value of the ``kind`` enum."""
    sample = _load_json(SAMPLE_PATH)
    episodes = sample["episodes"]
    assert isinstance(episodes, list)
    kinds = {ep["kind"] for ep in episodes}
    assert kinds == {"historical", "interview", "live", "themed", "meta"}


def test_sample_fixture_covers_access_values() -> None:
    """The fixture must include at least one public and one members episode."""
    sample = _load_json(SAMPLE_PATH)
    accesses = {ep["access"] for ep in sample["episodes"]}
    assert accesses == {"public", "members"}


def test_year_end_not_before_year_start() -> None:
    """Cross-field check the JSON Schema cannot express directly."""
    sample = _load_json(SAMPLE_PATH)
    for ep in sample["episodes"]:
        assert ep["year_end"] >= ep["year_start"], (
            f"episode {ep['guid']!r}: year_end {ep['year_end']} < year_start {ep['year_start']}"
        )

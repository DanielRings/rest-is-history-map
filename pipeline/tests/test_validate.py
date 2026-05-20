"""Edge-case tests for ``pipeline.validate``."""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from pipeline.validate import validate_document

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_PATH = REPO_ROOT / "data" / "samples" / "episodes.sample.json"


def _load_sample() -> dict[str, Any]:
    with SAMPLE_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)  # type: ignore[no-any-return]


def test_sample_document_validates() -> None:
    validate_document(_load_sample())


def test_year_end_before_year_start_is_rejected() -> None:
    doc = _load_sample()
    doc["episodes"][0]["year_start"] = 100
    doc["episodes"][0]["year_end"] = 50
    with pytest.raises(jsonschema.ValidationError, match="year_end"):
        validate_document(doc)


def test_year_zero_is_rejected() -> None:
    doc = _load_sample()
    doc["episodes"][0]["year_start"] = 0
    with pytest.raises(jsonschema.ValidationError):
        validate_document(doc)


def test_non_iso3_country_is_rejected() -> None:
    doc = _load_sample()
    doc["episodes"][0]["countries"] = ["gb"]  # lowercase fails the pattern
    with pytest.raises(jsonschema.ValidationError):
        validate_document(doc)


def test_missing_required_field_is_rejected() -> None:
    doc = _load_sample()
    del doc["episodes"][0]["kind"]
    with pytest.raises(jsonschema.ValidationError):
        validate_document(doc)


def test_unknown_additional_property_is_rejected() -> None:
    doc = _load_sample()
    doc["episodes"][0]["confidence"] = 0.9
    with pytest.raises(jsonschema.ValidationError):
        validate_document(doc)


def test_boundary_year_minus_one_to_one_validates() -> None:
    """The Christian-era boundary case: year_start = -1, year_end = 1 is legal."""
    doc = _load_sample()
    target = next(ep for ep in doc["episodes"] if ep["guid"] == "sample-boundary-jesus")
    # Re-assert the fixture itself uses the documented boundary representation.
    assert target["year_start"] == -1
    assert target["year_end"] == 1
    validate_document(doc)


def test_series_part_without_series_id_is_rejected() -> None:
    doc = _load_sample()
    target = copy.deepcopy(doc["episodes"][0])
    target["series_part"] = 1
    target.pop("series_id", None)
    doc["episodes"][0] = target
    with pytest.raises(jsonschema.ValidationError):
        validate_document(doc)

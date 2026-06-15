"""Write the validated dataset to ``data/episodes.json``.

The output is a single JSON object with ``version``, ``generated_at`` (UTC ISO
8601), and ``episodes`` keys. Validation runs inside ``emit`` so we never write
a file that doesn't conform to the contract.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pipeline.validate import validate_document

SCHEMA_VERSION = 1


def _midpoint(start: int, end: int) -> int:
    """Return the midpoint of [start, end], bumped to 1 if it would be year 0.

    Schema forbids year 0 (historians skip from -1 BC to AD 1); ranges that
    straddle the boundary get an anchor of AD 1 rather than 0.
    """
    m = (start + end) // 2
    return 1 if m == 0 else m


def _inject_series_dates(episodes: list[dict[str, Any]]) -> None:
    """Populate series-level fields on every episode in a series.

    Computes:
      - ``series_start``: ``year_start`` of the lowest-numbered part.
      - ``series_end``: ``year_end`` of the highest-numbered part.
      - ``series_year_anchor``: midpoint of series_start/series_end, unless
        any part has an explicit ``series_year_anchor`` in YAML — that
        override is propagated to all siblings.

    Mutates the episode dicts in place.

    Args:
        episodes: Episode dicts about to be wrapped and validated.

    Raises:
        ValueError: If two parts of the same series share a ``series_part``
            (would silently shadow each other in the bound computation), or
            if two parts disagree on an explicit ``series_year_anchor``.
    """
    by_series: dict[str, list[dict[str, Any]]] = {}
    for ep in episodes:
        sid = ep.get("series_id")
        if sid is None:
            continue
        by_series.setdefault(sid, []).append(ep)

    for sid, parts in by_series.items():
        parts_seen = [p["series_part"] for p in parts]
        if len(set(parts_seen)) != len(parts_seen):
            raise ValueError(f"series {sid!r}: duplicate series_part values {sorted(parts_seen)}")
        ordered = sorted(parts, key=lambda p: p["series_part"])
        series_start = ordered[0]["year_start"]
        series_end = ordered[-1]["year_end"]
        # Honor any author-provided series_year_anchor; reject disagreements.
        explicit = {p["series_year_anchor"] for p in parts if "series_year_anchor" in p}
        if len(explicit) > 1:
            raise ValueError(
                f"series {sid!r}: conflicting series_year_anchor overrides {sorted(explicit)}"
            )
        series_anchor = next(iter(explicit)) if explicit else _midpoint(series_start, series_end)
        for p in parts:
            p["series_start"] = series_start
            p["series_end"] = series_end
            p["series_year_anchor"] = series_anchor


def _inject_year_anchors(episodes: list[dict[str, Any]]) -> None:
    """Inject default ``year_anchor`` (= midpoint) for any episode missing one.

    The schema marks ``year_anchor`` optional but downstream consumers want
    every episode to have a sort key, so we materialize the default here.
    Author-provided overrides survive untouched.
    """
    for ep in episodes:
        if "year_anchor" not in ep:
            ep["year_anchor"] = _midpoint(ep["year_start"], ep["year_end"])


def _now_iso_utc() -> str:
    """Return the current UTC time as an ISO 8601 string with a ``Z`` suffix.

    Returns:
        A string like ``"2026-05-20T12:34:56.789012Z"``.
    """
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def emit(episodes: list[dict[str, Any]], out_path: Path) -> dict[str, Any]:
    """Wrap, validate, and write the episode dataset.

    Args:
        episodes: Episode dicts produced by ``pipeline.assemble``.
        out_path: Path to write the JSON output to. Parent directories are
            created if needed.

    Returns:
        The wrapped document that was written.

    Raises:
        jsonschema.ValidationError: If the assembled dataset does not conform
            to ``schema/episodes.schema.json`` or violates the cross-field
            ``year_end >= year_start`` rule.
    """
    _inject_series_dates(episodes)
    _inject_year_anchors(episodes)
    doc: dict[str, Any] = {
        "version": SCHEMA_VERSION,
        "generated_at": _now_iso_utc(),
        "episodes": episodes,
    }
    validate_document(doc)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return doc

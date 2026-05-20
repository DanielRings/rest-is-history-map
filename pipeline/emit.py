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

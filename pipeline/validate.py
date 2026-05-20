"""Validate the assembled dataset against ``schema/episodes.schema.json``.

Per the CLAUDE.md "never return default/fallback" rule, any violation raises
``jsonschema.ValidationError``. The schema's ``not: const: 0`` rule covers the
year-zero forbidden value; the cross-field ``year_end >= year_start`` check is
enforced here in Python because JSON Schema cannot reference siblings.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Any

import jsonschema
from jsonschema import Draft202012Validator

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = REPO_ROOT / "schema" / "episodes.schema.json"


@cache
def _validator() -> Draft202012Validator:
    """Return a cached Draft 2020-12 validator built from the schema file.

    Returns:
        A configured validator instance.
    """
    with SCHEMA_PATH.open(encoding="utf-8") as handle:
        schema = json.load(handle)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate_document(doc: dict[str, Any]) -> None:
    """Validate a wrapped pipeline document against the schema and cross-field rules.

    Args:
        doc: A document of shape ``{"version", "generated_at", "episodes"}``.

    Raises:
        jsonschema.ValidationError: If the document fails schema validation or
            any episode has ``year_end < year_start``.
    """
    _validator().validate(doc)
    for ep in doc["episodes"]:
        if ep["year_end"] < ep["year_start"]:
            raise jsonschema.ValidationError(
                f"episode {ep['guid']!r}: year_end {ep['year_end']} < year_start {ep['year_start']}"
            )

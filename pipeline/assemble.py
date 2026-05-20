"""Assemble all human-tagged episode YAMLs into an in-memory dataset.

Reads every ``data/episodes/*.yaml`` and returns a list of dicts suitable for
schema validation and JSON serialization. The YAMLs are the source of truth;
this module never writes to ``data/episodes/``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def assemble_episodes(episodes_dir: Path) -> list[dict[str, Any]]:
    """Load every ``{guid}.yaml`` under ``episodes_dir`` into a list of dicts.

    Args:
        episodes_dir: Directory holding human-tagged ``{guid}.yaml`` files.

    Returns:
        Episode dicts sorted by ``guid`` for reproducible output.

    Raises:
        ValueError: If a YAML file does not load as a mapping, or if the
            in-file ``guid`` disagrees with the filename.
    """
    out: list[dict[str, Any]] = []
    for path in sorted(episodes_dir.glob("*.yaml")):
        with path.open(encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
        if not isinstance(data, dict):
            raise ValueError(f"{path} did not parse as a YAML mapping")
        expected_guid = path.stem
        if data.get("guid") != expected_guid:
            raise ValueError(
                f"{path}: in-file guid {data.get('guid')!r} != filename stem {expected_guid!r}"
            )
        out.append(data)
    out.sort(key=lambda ep: ep["guid"])
    return out

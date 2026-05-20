"""Compare fetched RSS items against existing per-episode YAMLs and write stubs.

For every GUID in the feed that has no corresponding ``data/episodes/{guid}.yaml``
or ``data/pending/{guid}.yaml``, this module writes a new
``data/pending/{guid}.yaml`` with the RSS-derived fields filled in and the
tagging fields left blank for human review. Re-running is a no-op.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from pipeline.fetch import RawEpisode


def _access_from_episode_type(episode_type: str) -> str:
    """Map ``itunes:episodeType`` to the schema's ``access`` enum.

    Args:
        episode_type: The raw ``itunes:episodeType`` string, typically
            ``"full"`` or ``"bonus"``.

    Returns:
        ``"members"`` for ``"bonus"``, otherwise ``"public"``.
    """
    return "members" if episode_type == "bonus" else "public"


def _stub_body(raw: RawEpisode) -> dict[str, Any]:
    """Build the YAML body for a brand-new pending stub.

    Args:
        raw: A ``RawEpisode`` from ``pipeline.fetch``.

    Returns:
        An ordered dict with RSS-derived fields populated and tagging fields
        left blank for human review.
    """
    return {
        "guid": raw["guid"],
        "title": raw["title"],
        "description": raw["description"],
        "pub_date": raw["pub_date"],
        "access": _access_from_episode_type(raw["episode_type"]),
        "countries": [],
        "year_start": None,
        "year_end": None,
        "date_precision": None,
        "kind": None,
        "topics": [],
        "historical_figures": [],
        "links": {},
    }


def diff_and_write_stubs(
    raw_episodes: list[RawEpisode],
    episodes_dir: Path,
    pending_dir: Path,
) -> list[str]:
    """Write a pending stub for each GUID that does not yet exist on disk.

    Args:
        raw_episodes: Raw episodes from ``pipeline.fetch``.
        episodes_dir: Directory holding human-tagged ``{guid}.yaml`` files.
        pending_dir: Directory where new stubs are written. Created if absent.

    Returns:
        The GUIDs of episodes for which a stub was written, in feed order. A
        re-run with the same inputs returns an empty list.
    """
    pending_dir.mkdir(parents=True, exist_ok=True)
    new_guids: list[str] = []
    for raw in raw_episodes:
        guid = raw["guid"]
        if (episodes_dir / f"{guid}.yaml").exists():
            continue
        stub_path = pending_dir / f"{guid}.yaml"
        if stub_path.exists():
            continue
        with stub_path.open("w", encoding="utf-8") as handle:
            yaml.safe_dump(
                _stub_body(raw),
                handle,
                sort_keys=False,
                allow_unicode=True,
            )
        new_guids.append(guid)
    return new_guids

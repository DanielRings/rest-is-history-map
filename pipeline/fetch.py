"""Fetch and parse the Supporting Cast RSS feed into raw episode records.

Tests pass a local file path for ``source``; feedparser handles either a URL or
a filesystem path transparently, so no network is hit in unit tests.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import TypedDict, cast

import feedparser  # type: ignore[import-untyped]


class RawEpisode(TypedDict):
    """A minimal episode record extracted from the RSS feed.

    Attributes:
        guid: Stable RSS GUID. Used as the per-episode file key.
        title: Episode title.
        description: Episode description / summary as published in the feed.
        pub_date: ISO 8601 UTC timestamp with a ``Z`` suffix.
        audio_url: URL of the audio enclosure.
        episode_type: ``itunes:episodeType`` value, typically ``full`` or ``bonus``.
    """

    guid: str
    title: str
    description: str
    pub_date: str
    audio_url: str
    episode_type: str


def _require(entry: feedparser.FeedParserDict, key: str) -> object:
    """Return ``entry[key]`` or raise ``ValueError`` if absent or falsy.

    Args:
        entry: A feedparser entry.
        key: The attribute name to look up.

    Returns:
        The value stored at ``key``.

    Raises:
        ValueError: If the key is missing, ``None``, or empty.
    """
    value = entry.get(key)
    if not value:
        raise ValueError(f"RSS entry is missing required field {key!r}: {entry.get('id')!r}")
    return value


def _pub_date_iso(entry: feedparser.FeedParserDict) -> str:
    """Convert a feedparser ``published_parsed`` struct_time to ISO 8601 UTC.

    Args:
        entry: A feedparser entry.

    Returns:
        An ISO 8601 timestamp like ``"2024-10-01T07:00:00Z"``.

    Raises:
        ValueError: If ``published_parsed`` is absent or unparseable.
    """
    parsed = entry.get("published_parsed")
    if parsed is None:
        raise ValueError(f"RSS entry is missing 'published_parsed': {entry.get('id')!r}")
    dt = datetime(
        year=parsed.tm_year,
        month=parsed.tm_mon,
        day=parsed.tm_mday,
        hour=parsed.tm_hour,
        minute=parsed.tm_min,
        second=parsed.tm_sec,
        tzinfo=UTC,
    )
    return dt.isoformat().replace("+00:00", "Z")


def _audio_url(entry: feedparser.FeedParserDict) -> str:
    """Return the first audio enclosure URL.

    Args:
        entry: A feedparser entry.

    Returns:
        The ``href`` of the first enclosure.

    Raises:
        ValueError: If the entry has no enclosure with an ``href``.
    """
    enclosures = entry.get("enclosures") or []
    for enc in enclosures:
        href = enc.get("href")
        if href:
            return cast(str, href)
    raise ValueError(f"RSS entry has no audio enclosure: {entry.get('id')!r}")


def fetch_raw_episodes(source: str) -> list[RawEpisode]:
    """Parse an RSS feed (URL or local file path) into raw episode records.

    Args:
        source: HTTP(S) URL of the feed, or a local filesystem path. Feedparser
            handles both transparently.

    Returns:
        One ``RawEpisode`` per ``<item>`` in feed order.

    Raises:
        ValueError: If a parsed entry is missing a required field.
    """
    feed = feedparser.parse(source)
    out: list[RawEpisode] = []
    for entry in feed.entries:
        episode_type = entry.get("itunes_episodetype")
        if not episode_type:
            raise ValueError(f"RSS entry is missing 'itunes:episodeType': {entry.get('id')!r}")
        out.append(
            RawEpisode(
                guid=cast(str, _require(entry, "id")),
                title=cast(str, _require(entry, "title")),
                description=cast(str, _require(entry, "summary")),
                pub_date=_pub_date_iso(entry),
                audio_url=_audio_url(entry),
                episode_type=cast(str, episode_type),
            )
        )
    return out


def fetch_from_env() -> list[RawEpisode]:
    """Fetch raw episodes using the feed URL stored in ``RIH_RSS_URL``.

    Returns:
        One ``RawEpisode`` per ``<item>`` in feed order.

    Raises:
        RuntimeError: If ``RIH_RSS_URL`` is not set or is empty.
    """
    url = os.environ.get("RIH_RSS_URL")
    if not url:
        raise RuntimeError(
            "RIH_RSS_URL is not set. Export the Supporting Cast feed URL before refresh."
        )
    return fetch_raw_episodes(url)

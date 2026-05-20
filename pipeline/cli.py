"""Command-line entry point for the pipeline.

Subcommands:
    ``rih-pipeline refresh``: fetch RSS, write new pending stubs.
    ``rih-pipeline build``: assemble + validate + emit ``data/episodes.json``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import jsonschema

from pipeline.assemble import assemble_episodes
from pipeline.diff import diff_and_write_stubs
from pipeline.emit import emit
from pipeline.fetch import fetch_from_env

REPO_ROOT = Path(__file__).resolve().parents[1]
EPISODES_DIR = REPO_ROOT / "data" / "episodes"
PENDING_DIR = REPO_ROOT / "data" / "pending"
OUTPUT_PATH = REPO_ROOT / "data" / "episodes.json"


def _cmd_refresh(_: argparse.Namespace) -> int:
    """Fetch the live RSS feed and write a pending stub for each new GUID.

    Args:
        _: Parsed CLI arguments (unused).

    Returns:
        Process exit code.
    """
    raw = fetch_from_env()
    new_guids = diff_and_write_stubs(raw, EPISODES_DIR, PENDING_DIR)
    print(f"refresh: {len(new_guids)} new stub(s) written to {PENDING_DIR}")
    for guid in new_guids:
        print(f"  + {guid}")
    return 0


def _cmd_build(_: argparse.Namespace) -> int:
    """Assemble tagged YAMLs, validate, and emit ``data/episodes.json``.

    Args:
        _: Parsed CLI arguments (unused).

    Returns:
        Process exit code: 0 on success, 1 on validation failure.
    """
    episodes = assemble_episodes(EPISODES_DIR)
    try:
        emit(episodes, OUTPUT_PATH)
    except jsonschema.ValidationError as exc:
        print(f"build: validation failed: {exc.message}", file=sys.stderr)
        return 1
    print(f"build: wrote {len(episodes)} episode(s) to {OUTPUT_PATH}")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    """Construct the top-level CLI parser.

    Returns:
        A configured ``ArgumentParser``.
    """
    parser = argparse.ArgumentParser(
        prog="rih-pipeline",
        description="Producer pipeline for the Rest Is History map+timeline browser.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    refresh = subparsers.add_parser("refresh", help="Fetch RSS and write new pending stubs.")
    refresh.set_defaults(func=_cmd_refresh)

    build = subparsers.add_parser("build", help="Assemble, validate, and emit data/episodes.json.")
    build.set_defaults(func=_cmd_build)

    return parser


def main() -> None:
    """Pipeline CLI entry point.

    Raises:
        SystemExit: With the return code of the chosen subcommand.
    """
    parser = _build_parser()
    args = parser.parse_args()
    sys.exit(args.func(args))

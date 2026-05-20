#!/usr/bin/env bash
# Populate the RIH_RSS_URL GitHub Actions secret from a local .env file.
#
# Usage:
#   scripts/setup-secrets.sh              # reads .env at repo root
#   RIH_RSS_URL=... scripts/setup-secrets.sh  # or pass via env directly
#
# Requires: gh CLI authenticated against the rest-is-history-map repo.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${repo_root}/.env"

if [ -z "${RIH_RSS_URL:-}" ] && [ -f "${env_file}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${env_file}"
  set +a
fi

if [ -z "${RIH_RSS_URL:-}" ]; then
  echo "error: RIH_RSS_URL is not set and ${env_file} is missing or empty." >&2
  echo "Create .env with: RIH_RSS_URL=<supporting-cast-feed-url>" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found. Install: https://cli.github.com/" >&2
  exit 1
fi

printf '%s' "${RIH_RSS_URL}" | gh secret set RIH_RSS_URL
echo "RIH_RSS_URL secret set on the current gh-default repo."

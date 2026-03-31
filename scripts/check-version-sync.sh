#!/bin/bash
# ─────────────────────────────────────────────────────────────
# scripts/check-version-sync.sh
#
# Verify that all documentation version references match package.json.
# Runs as a pre-merge gate in CI to prevent stale version numbers.
#
# Usage:
#   bash scripts/check-version-sync.sh
#
# Exit codes:
#   0 - all versions consistent
#   1 - one or more mismatches found
#
# @see profile/04-发布检查清单.md
# ─────────────────────────────────────────────────────────────

set -eo pipefail
# Note: -u (nounset) intentionally omitted — local var assignments from
# positional params trigger false "unbound variable" errors in some bash versions.

# ── locate project root ──────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── read version from package.json ───────────────────────────

VERSION=$(node -p "require('./package.json').version")

if [ -z "$VERSION" ]; then
  echo "ERROR: could not read version from package.json"
  exit 1
fi

echo "package.json version: v${VERSION}"
echo "──────────────────────────────────────────"

ERRORS=0

# ── helper ───────────────────────────────────────────────────

check_file() {
  local file
  local pattern
  local description
  file="${1:-}"
  pattern="${2:-}"
  description="${3:-}"

  if [ -z "$pattern" ]; then
    echo "SKIP (no pattern): ${file}"
    return
  fi

  if [ ! -f "$file" ]; then
    echo "SKIP (not found): ${file}"
    return
  fi

  if grep -q "$pattern" "$file"; then
    echo "OK   ${description}"
  else
    echo "FAIL ${description}"
    echo "     file:    ${file}"
    echo "     pattern: ${pattern}"
    ERRORS=$((ERRORS + 1))
  fi
}

# ── checks ───────────────────────────────────────────────────

# 1. website/rspress.config.ts — navbar version text: "vX.Y.Z"
check_file \
  "website/rspress.config.ts" \
  "\"v${VERSION}\"" \
  "website/rspress.config.ts -> v${VERSION}"

# 2. website/docs/guide/cli.md — vext --version output example
check_file \
  "website/docs/guide/cli.md" \
  "vextjs v${VERSION}" \
  "website/docs/guide/cli.md -> vextjs v${VERSION}"

# 3. website/docs/guide/quick-start.md — dependency "vextjs": "^X.Y.Z"
check_file \
  "website/docs/guide/quick-start.md" \
  "\"vextjs\": \"\\^${VERSION}\"" \
  "website/docs/guide/quick-start.md -> ^${VERSION}"

# 4. README.md — dependency "vextjs": "^X.Y.Z"
check_file \
  "README.md" \
  "\"vextjs\": \"\\^${VERSION}\"" \
  "README.md -> ^${VERSION}"

# ── summary ──────────────────────────────────────────────────

echo "──────────────────────────────────────────"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "ERROR: ${ERRORS} version mismatch(es) found."
  echo "       See profile/04-发布检查清单.md for the full sync checklist."
  echo ""
  exit 1
else
  echo ""
  echo "OK: all version references match package.json (v${VERSION})"
  echo ""
  exit 0
fi

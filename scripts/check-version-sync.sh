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
# @see .devcodex/profile/05-发布规范.md
# ─────────────────────────────────────────────────────────────

set -eo pipefail
# Note: -u (nounset) intentionally omitted — local var assignments from
# positional params trigger false "unbound variable" errors in some bash versions.

# ── locate project root ──────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ── read version from package.json ───────────────────────────

read_version() {
  if command -v node >/dev/null 2>&1; then
    node -p "require('./package.json').version"
    return 0
  fi

  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).version" | tr -d '\r'
    return 0
  fi

  return 1
}

VERSION=$(read_version || true)

if [ -z "$VERSION" ]; then
  echo "ERROR: could not read version from package.json (node / powershell fallback unavailable)"
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
    echo "FAIL ${description}"
    echo "     file not found: ${file}"
    ERRORS=$((ERRORS + 1))
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

# 2. website/docs/{en,zh}/guide/cli.md — vext --version output example
check_file \
  "website/docs/en/guide/cli.md" \
  "vextjs v${VERSION}" \
  "website/docs/en/guide/cli.md -> vextjs v${VERSION}"

check_file \
  "website/docs/zh/guide/cli.md" \
  "vextjs v${VERSION}" \
  "website/docs/zh/guide/cli.md -> vextjs v${VERSION}"

# 3. website/docs/{en,zh}/guide/quick-start.md — dependency "vextjs": "^X.Y.Z"
check_file \
  "website/docs/en/guide/quick-start.md" \
  "\"vextjs\": \"\\^${VERSION}\"" \
  "website/docs/en/guide/quick-start.md -> ^${VERSION}"

check_file \
  "website/docs/zh/guide/quick-start.md" \
  "\"vextjs\": \"\\^${VERSION}\"" \
  "website/docs/zh/guide/quick-start.md -> ^${VERSION}"

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
  echo "       See .devcodex/profile/05-发布规范.md for the full sync checklist."
  echo ""
  exit 1
else
  echo ""
  echo "OK: all version references match package.json (v${VERSION})"
  echo ""
  exit 0
fi

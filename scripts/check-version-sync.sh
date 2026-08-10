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
    echo "FAIL ${description}"
    echo "     file:    ${file}"
    echo "     reason:  expected pattern is empty"
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [ ! -f "$file" ]; then
    echo "FAIL ${description}"
    echo "     file:    ${file}"
    echo "     reason:  required versioned document is missing"
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

# 2. Bilingual CLI pages — vext --version output example
for locale in en zh; do
  check_file \
    "website/docs/${locale}/guide/cli.md" \
    "vextjs v${VERSION}" \
    "website/docs/${locale}/guide/cli.md -> vextjs v${VERSION}"
done

# 3. Bilingual quick-start pages — dependency "vextjs": "^X.Y.Z"
for locale in en zh; do
  check_file \
    "website/docs/${locale}/guide/quick-start.md" \
    "\"vextjs\": \"\\^${VERSION}\"" \
    "website/docs/${locale}/guide/quick-start.md -> ^${VERSION}"
done

# 4. Root README — stable package entry (must not advertise an unpublished exact patch)
if grep -Eq '"vextjs"[[:space:]]*:[[:space:]]*"\^[0-9]+\.[0-9]+\.[0-9]+"' README.md; then
  echo "FAIL: README.md must not hardcode a package patch version"
  ERRORS=$((ERRORS + 1))
else
  echo "OK:   README.md uses a version-agnostic package entry"
fi

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

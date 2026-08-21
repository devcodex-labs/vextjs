#!/bin/bash
# ─────────────────────────────────────────────────────────────
# scripts/check-version-sync.sh
#
# Cross-platform wrapper for the stable/next documentation version contract.
# The Node implementation is shared by local CI, GitHub CI and tag releases.
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

if command -v node >/dev/null 2>&1; then
  exec node "scripts/check-version-sync.mjs" "$@"
fi

if command -v node.exe >/dev/null 2>&1; then
  exec node.exe "scripts/check-version-sync.mjs" "$@"
fi

echo "ERROR: Node.js (node or node.exe) is required for the version channel check."
exit 1

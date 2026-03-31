#!/bin/bash
# ─────────────────────────────────────────────────────────────
# scripts/ci-local.sh
#
# 本地 CI 验证脚本 — 在 push 前模拟 GitHub Actions CI 全流程。
# 按照 .github/workflows/ci.yml 的 job 顺序依次执行，
# 在本地捕获绝大多数 CI 失败场景，避免 push 后才发现。
#
# 用法:
#   bash scripts/ci-local.sh          # 运行全部检查
#   bash scripts/ci-local.sh --quick  # 快速模式（跳过 e2e + docs）
#
# 退出码:
#   0 — 所有检查通过
#   1 — 存在失败项
#
# 对应 CI Jobs:
#   0. version-check     → bash scripts/check-version-sync.sh
#   1. lint-typecheck     → tsc --noEmit + npm run build
#   2. unit-tests         → vitest run test/unit
#   3. integration-tests  → npm run build + vitest run test/integration
#   4. e2e-tests          → vitest run test/e2e
#   5. format-check       → prettier --check .
#   6. docs-build         → cd website && npm run build
#
# @see .github/workflows/ci.yml
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ── 配置 ────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

QUICK_MODE=false
if [[ "${1:-}" == "--quick" ]]; then
  QUICK_MODE=true
fi

# ── 颜色定义 ────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ── 辅助函数 ────────────────────────────────────────────────

ERRORS=0
TOTAL=0
SKIPPED=0
STEP_START=0

step_start() {
  local step_name="$1"
  TOTAL=$((TOTAL + 1))
  STEP_START=$(date +%s)
  echo ""
  echo -e "${CYAN}${BOLD}── [${TOTAL}] ${step_name} ──────────────────────────────${NC}"
}

step_pass() {
  local elapsed=$(( $(date +%s) - STEP_START ))
  echo -e "${GREEN}✅ 通过${NC} (${elapsed}s)"
}

step_fail() {
  local elapsed=$(( $(date +%s) - STEP_START ))
  echo -e "${RED}❌ 失败${NC} (${elapsed}s)"
  ERRORS=$((ERRORS + 1))
}

step_skip() {
  echo -e "${YELLOW}⏭️  跳过${NC} (--quick 模式)"
  SKIPPED=$((SKIPPED + 1))
}

# ── 开始 ────────────────────────────────────────────────────

TOTAL_START=$(date +%s)
echo -e "${BOLD}🔍 vext 本地 CI 验证${NC}"
echo "──────────────────────────────────────────"
if $QUICK_MODE; then
  echo -e "${YELLOW}⚡ 快速模式：跳过 e2e-tests 和 docs-build${NC}"
fi
echo ""

# ── 0. Version Check ────────────────────────────────────────

step_start "Version Sync Check"
# Use pure bash+grep to extract version — no node required in this context.
# (check-version-sync.sh uses `node` which may not be in Git Bash PATH)
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

if [ -z "$VERSION" ]; then
  echo "❌ 无法从 package.json 读取版本号"
  step_fail
else
  echo "📦 package.json version: v${VERSION}"
  echo "──────────────────────────────────────────"
  VER_ERRORS=0

  check_version() {
    local file="$1"
    local pattern="$2"
    local label="$3"
    if [ ! -f "$file" ]; then
      echo "⚠️  跳过 ${file}（文件不存在）"
      return
    fi
    if grep -qF "$pattern" "$file"; then
      echo "✅ ${label}"
    else
      echo "❌ ${label}"
      echo "   文件: ${file}"
      echo "   期望包含: ${pattern}"
      VER_ERRORS=$((VER_ERRORS + 1))
    fi
  }

  check_version "website/rspress.config.ts"          "\"v${VERSION}\""        "rspress.config.ts → v${VERSION}"
  check_version "website/docs/guide/cli.md"          "vextjs v${VERSION}"     "cli.md → vextjs v${VERSION}"
  check_version "website/docs/guide/quick-start.md"  "\"vextjs\": \"^${VERSION}\"" "quick-start.md → ^${VERSION}"
  check_version "README.md"                          "\"vextjs\": \"^${VERSION}\"" "README.md → ^${VERSION}"
  check_version "CHANGELOG.md"                       "[${VERSION}]"           "CHANGELOG.md → [${VERSION}]"

  if [ "$VER_ERRORS" -gt 0 ]; then
    step_fail
  else
    step_pass
  fi
fi

# ── 1. Lint + Typecheck ─────────────────────────────────────

step_start "TypeScript Type Check"
if npx tsc --noEmit; then
  step_pass
else
  step_fail
fi

step_start "Build (ESM + CJS)"
if npm run build; then
  step_pass
else
  step_fail
fi

# ── 2. Unit Tests ───────────────────────────────────────────

step_start "Unit Tests"
if npx vitest run test/unit --reporter=verbose; then
  step_pass
else
  step_fail
fi

# ── 3. Integration Tests ───────────────────────────────────

step_start "Integration Tests"
if npx vitest run test/integration --reporter=verbose; then
  step_pass
else
  step_fail
fi

# ── 4. E2E Tests ───────────────────────────────────────────

step_start "E2E Tests"
if $QUICK_MODE; then
  step_skip
else
  if npx vitest run test/e2e --reporter=verbose; then
    step_pass
  else
    step_fail
  fi
fi

# ── 5. Format Check ────────────────────────────────────────

step_start "Prettier Format Check"
if npx prettier --check .; then
  step_pass
else
  step_fail
fi

# ── 6. Docs Build ──────────────────────────────────────────

step_start "Docs Build (website)"
if $QUICK_MODE; then
  step_skip
else
  if [ -d "website" ] && [ -f "website/package.json" ]; then
    (cd website && npm ci --silent && npm run build)
    if [ $? -eq 0 ]; then
      step_pass
    else
      step_fail
    fi
  else
    echo -e "${YELLOW}⚠️  website/ 目录不存在，跳过${NC}"
    SKIPPED=$((SKIPPED + 1))
  fi
fi

# ── 汇总 ────────────────────────────────────────────────────

TOTAL_ELAPSED=$(( $(date +%s) - TOTAL_START ))
PASSED=$((TOTAL - ERRORS - SKIPPED))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}📊 本地 CI 结果汇总${NC}  (${TOTAL_ELAPSED}s)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  通过: ${GREEN}${PASSED}${NC}"
echo -e "  失败: ${RED}${ERRORS}${NC}"
echo -e "  跳过: ${YELLOW}${SKIPPED}${NC}"
echo -e "  总计: ${TOTAL}"
echo ""

if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}${BOLD}❌ 本地 CI 未通过 — 请修复后再 push${NC}"
  exit 1
else
  echo -e "${GREEN}${BOLD}✅ 本地 CI 全部通过 — 可以安全 push${NC}"
  exit 0
fi


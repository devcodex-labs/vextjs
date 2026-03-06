#!/bin/bash
# ─────────────────────────────────────────────────────────────
# scripts/check-version-sync.sh
#
# 检查所有文档中的版本号是否与 package.json 一致。
# 在 CI 中作为 pre-merge 门禁运行，防止版本发布时遗漏文档同步。
#
# 用法:
#   bash scripts/check-version-sync.sh
#
# 退出码:
#   0 — 所有版本号一致
#   1 — 存在版本号不一致
#
# @see RELEASE-CHECKLIST.md
# ─────────────────────────────────────────────────────────────

set -euo pipefail

# ── 获取 package.json 中的版本号 ──────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION=$(node -p "require('./package.json').version")

if [ -z "$VERSION" ]; then
  echo "❌ 无法从 package.json 读取版本号"
  exit 1
fi

echo "📦 package.json version: v${VERSION}"
echo "──────────────────────────────────────────"

ERRORS=0

# ── 辅助函数 ──────────────────────────────────────────────────

check_file() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if [ ! -f "$file" ]; then
    echo "⚠️  跳过 ${file}（文件不存在）"
    return
  fi

  if grep -q "$pattern" "$file"; then
    echo "✅ ${description}"
  else
    echo "❌ ${description}"
    echo "   文件: ${file}"
    echo "   期望匹配: ${pattern}"
    ERRORS=$((ERRORS + 1))
  fi
}

# ── 逐项检查 ──────────────────────────────────────────────────

# 1. website/rspress.config.ts — 导航栏版本号 text: "vX.Y.Z"
check_file \
  "website/rspress.config.ts" \
  "\"v${VERSION}\"" \
  "website/rspress.config.ts 导航栏版本号 → v${VERSION}"

# 2. website/docs/guide/cli.md — vext --version 输出示例
check_file \
  "website/docs/guide/cli.md" \
  "vextjs v${VERSION}" \
  "website/docs/guide/cli.md 版本输出示例 → vextjs v${VERSION}"

# 3. website/docs/guide/quick-start.md — 依赖版本 "vextjs": "^X.Y.Z"
check_file \
  "website/docs/guide/quick-start.md" \
  "\"vextjs\": \"\\^${VERSION}\"" \
  "website/docs/guide/quick-start.md 依赖版本 → ^${VERSION}"

# 4. README.md — 依赖版本 "vextjs": "^X.Y.Z"
check_file \
  "README.md" \
  "\"vextjs\": \"\\^${VERSION}\"" \
  "README.md 依赖版本 → ^${VERSION}"

# ── 结果汇总 ──────────────────────────────────────────────────

echo "──────────────────────────────────────────"

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "⚠️  发现 ${ERRORS} 处版本号不一致！"
  echo "   请参考 RELEASE-CHECKLIST.md 逐项更新后重新提交。"
  echo ""
  exit 1
else
  echo ""
  echo "✅ 所有文档版本号与 package.json (v${VERSION}) 一致"
  echo ""
  exit 0
fi

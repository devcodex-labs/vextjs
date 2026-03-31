#!/bin/bash
# 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
# scripts/check-version-sync.sh
#
# 妫€鏌ユ墍鏈夋枃妗ｄ腑鐨勭増鏈彿鏄惁涓?package.json 涓€鑷淬€?# 鍦?CI 涓綔涓?pre-merge 闂ㄧ杩愯锛岄槻姝㈢増鏈彂甯冩椂閬楁紡鏂囨。鍚屾銆?#
# 鐢ㄦ硶:
#   bash scripts/check-version-sync.sh
#
# 閫€鍑虹爜:
#   0 鈥?鎵€鏈夌増鏈彿涓€鑷?#   1 鈥?瀛樺湪鐗堟湰鍙蜂笉涓€鑷?#
# @see RELEASE-CHECKLIST.md
# 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

set -euo pipefail

# 鈹€鈹€ 鑾峰彇 package.json 涓殑鐗堟湰鍙?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION=$(node -p "require('./package.json').version")

if [ -z "$VERSION" ]; then
  echo "鉂?鏃犳硶浠?package.json 璇诲彇鐗堟湰鍙?
  exit 1
fi

echo "馃摝 package.json version: v${VERSION}"
echo "鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€"

ERRORS=0

# 鈹€鈹€ 杈呭姪鍑芥暟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

check_file() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if [ ! -f "$file" ]; then
    echo "鈿狅笍  璺宠繃 ${file}锛堟枃浠朵笉瀛樺湪锛?
    return
  fi

  if grep -q "$pattern" "$file"; then
    echo "鉁?${description}"
  else
    echo "鉂?${description}"
    echo "   鏂囦欢: ${file}"
    echo "   鏈熸湜鍖归厤: ${pattern}"
    ERRORS=$((ERRORS + 1))
  fi
}

# 鈹€鈹€ 閫愰」妫€鏌?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

# 1. website/rspress.config.ts 鈥?瀵艰埅鏍忕増鏈彿 text: "vX.Y.Z"
check_file \
  "website/rspress.config.ts" \
  "\"v${VERSION}\"" \
  "website/rspress.config.ts 瀵艰埅鏍忕増鏈彿 鈫?v${VERSION}"

# 2. website/docs/guide/cli.md 鈥?vext --version 杈撳嚭绀轰緥
check_file \
  "website/docs/guide/cli.md" \
  "vextjs v${VERSION}" \
  "website/docs/guide/cli.md 鐗堟湰杈撳嚭绀轰緥 鈫?vextjs v${VERSION}"

# 3. website/docs/guide/quick-start.md 鈥?渚濊禆鐗堟湰 "vextjs": "^X.Y.Z"
check_file \
  "website/docs/guide/quick-start.md" \
  "\"vextjs\": \"\\^${VERSION}\"" \
  "website/docs/guide/quick-start.md 渚濊禆鐗堟湰 鈫?^${VERSION}"

# 4. README.md 鈥?渚濊禆鐗堟湰 "vextjs": "^X.Y.Z"
check_file \
  "README.md" \
  "\"vextjs\": \"\\^${VERSION}\"" \
  "README.md 渚濊禆鐗堟湰 鈫?^${VERSION}"

# 鈹€鈹€ 缁撴灉姹囨€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

echo "鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€"

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "鈿狅笍  鍙戠幇 ${ERRORS} 澶勭増鏈彿涓嶄竴鑷达紒"
  echo "   璇峰弬鑰?RELEASE-CHECKLIST.md 閫愰」鏇存柊鍚庨噸鏂版彁浜ゃ€?
  echo ""
  exit 1
else
  echo ""
  echo "鉁?鎵€鏈夋枃妗ｇ増鏈彿涓?package.json (v${VERSION}) 涓€鑷?
  echo ""
  exit 0
fi

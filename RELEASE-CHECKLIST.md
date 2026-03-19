# Release Checklist

当 `package.json` 中的 `version` 字段发生变更时（例如 `0.1.4` → `0.1.5`），**必须**按以下清单逐项检查并同步更新。

> ⚠️ 此清单是强制性的。每次版本发布 PR 中，提交者和审阅者都必须确认所有项已完成。

---

## 必须更新

- [ ] **`package.json`** — `version` 字段（主版本号来源）
- [ ] **`CHANGELOG.md`** — 新增 `[X.Y.Z] - YYYY-MM-DD` 版本条目，将 `[Unreleased]` 中的内容移入
- [ ] **`src/cli/create.ts`** — `generatePackageJson` 中 `vextjs` 依赖版本（已改为动态读取，确认 `readVextVersion()` 正常工作）
      smoke test：`vext create test-smoke --skip-install`，检查生成的 `package.json` 中 `vextjs` 版本与 `package.json` 当前版本一致，完成后删除 `test-smoke/`
- [ ] **`README.md`** — 快速开始 → `"dependencies"` 中的 `"vextjs": "^X.Y.Z"`
- [ ] **`website/rspress.config.ts`** — 导航栏 `text: "vX.Y.Z"` 版本号
- [ ] **`website/docs/guide/quick-start.md`** — 手动创建项目 → `"dependencies"` 中的 `"vextjs": "^X.Y.Z"`
- [ ] **`website/docs/guide/cli.md`** — `vext --version` 输出示例 `# 输出: vextjs vX.Y.Z`

## 条件更新

- [ ] **`changelogs/vX.Y.Z.md`** — 详细变更日志（如果该版本包含重要变更）
- [ ] **`website/docs/guide/`** — 涉及新功能/行为变更的文档页面
- [ ] **`website/docs/api/`** — 涉及 API 变更的文档页面
- [ ] **`CONTRIBUTING.md`** — 如有贡献流程或开发环境变更
- [ ] **`website/docs/guide/hot-reload.md`** — 如热重载行为或日志格式有变更
- [ ] **`website/docs/guide/logger.md`** — 如日志格式、配置项或存储方案有变更

## 构建验证

- [ ] `npm run build` — 框架编译成功（ESM + CJS）
- [ ] `npm test` — 所有单元/集成/E2E 测试通过
- [ ] `cd website && npm run build` — 文档站编译成功
- [ ] `node verify.mjs`（在 vext-test 项目中）— 121/121 功能验证通过

## 发布流程

- [ ] 合并所有变更到 `main` 分支
- [ ] 创建 Git tag：`git tag vX.Y.Z`
- [ ] 推送 tag：`git push origin vX.Y.Z`
- [ ] 创建 GitHub Release（附 changelog 摘要）
- [ ] 发布到 npm：`npm publish`
- [ ] 部署文档站（如有独立部署流程）

## 发布后验证

- [ ] `npm info vextjs version` 确认 npm 上的版本号正确
- [ ] 在干净环境中执行 `npx vext create test-app` 确认脚手架可用
- [ ] 文档站在线版本号显示正确

---

## 自动化（推荐）

建议在 CI 中增加版本号一致性检测脚本，在 PR 合并前自动检查：

```bash
#!/bin/bash
# scripts/check-version-sync.sh
# 检查所有文档中的版本号是否与 package.json 一致

VERSION=$(node -p "require('./package.json').version")

ERRORS=0

# 检查 rspress.config.ts
if ! grep -q "\"v${VERSION}\"" website/rspress.config.ts; then
  echo "❌ website/rspress.config.ts 版本号未更新为 v${VERSION}"
  ERRORS=$((ERRORS + 1))
fi

# 检查 cli.md
if ! grep -q "vextjs v${VERSION}" website/docs/guide/cli.md; then
  echo "❌ website/docs/guide/cli.md 版本输出示例未更新为 v${VERSION}"
  ERRORS=$((ERRORS + 1))
fi

# 检查 quick-start.md
if ! grep -q "\"vextjs\": \"\\^${VERSION}\"" website/docs/guide/quick-start.md; then
  echo "❌ website/docs/guide/quick-start.md 依赖版本未更新为 ^${VERSION}"
  ERRORS=$((ERRORS + 1))
fi

# 检查 README.md
if ! grep -q "\"vextjs\": \"\\^${VERSION}\"" README.md; then
  echo "❌ README.md 依赖版本未更新为 ^${VERSION}"
  ERRORS=$((ERRORS + 1))
fi

if [ $ERRORS -gt 0 ]; then
  echo ""
  echo "⚠️  发现 ${ERRORS} 处版本号不一致，请参考 RELEASE-CHECKLIST.md 更新"
  exit 1
else
  echo "✅ 所有文档版本号与 package.json (v${VERSION}) 一致"
fi
```

将此脚本加入 CI 流水线（GitHub Actions / GitLab CI），在每次包含 `package.json` 变更的 PR 中自动运行。
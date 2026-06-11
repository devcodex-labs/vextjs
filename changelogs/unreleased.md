# Unreleased

## 2026-06-11

- **Logger pretty color**：新增 `logger.prettyColor: "auto" | "always" | "never"`，仅在 pretty 文本模式下为 level label 输出固定 ANSI 颜色；JSON 日志保持无 ANSI，并继续保持零 runtime logger 颜色依赖。

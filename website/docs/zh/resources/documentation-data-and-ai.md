---
title: 文档数据与 AI
description: 面向 VextJS 的 canonical、机器可读文档资产，以及隐私优先的度量边界。
---

# 文档数据与 AI

VextJS 同时提供面向读者的文档页面和确定性的构建产物。这样能让搜索、AI 辅助分析和文档质量检查更可靠，
不需要读者信任不透明的 crawler 或 tracker。

## 公开机器可读资产

| 资产                                                                                                      | 用途                                                                                              |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [`docs-manifest.json`](https://devcodex-labs.github.io/vextjs/docs-manifest.json)                         | 构建生成的页面元数据：canonical URL、locale、摘要、受众、适用面、稳定性、关联页面和 source hash。 |
| [`capabilities.json`](https://devcodex-labs.github.io/vextjs/capabilities.json)                           | 已支持的 frontend/runtime 能力和明确 non-goal；必须与对应细节页一起引用。                         |
| [`ai-gold-questions.json`](https://devcodex-labs.github.io/vextjs/ai-gold-questions.json)                 | 要求引用来源的问题集合，防止回答虚构未支持能力。                                                  |
| [`llms.txt`](https://devcodex-labs.github.io/vextjs/llms.txt)                                             | 面向语言模型和文档工具的精选入口；它是索引，不是 crawler 控制文件。                               |
| [`llms-full.txt`](https://devcodex-labs.github.io/vextjs/llms-full.txt)                                   | 英文和简体中文全部文档页的构建生成索引。                                                          |
| [`docs-events.schema.json`](https://devcodex-labs.github.io/vextjs/docs-events.schema.json)               | 可选的隐私保护事件合同；VextJS 没有启用 collector。                                               |
| [`docs-dashboard-definition.json`](https://devcodex-labs.github.io/vextjs/docs-dashboard-definition.json) | 供未来自行选择合规 collector 的站点所有者使用的指标定义和采集边界。                               |

机器资产在文档构建完成后生成，不含 build timestamp，因此相同 source 会生成相同的 metadata 和 hash。

## AI 回答应如何使用文档

1. 先在 `docs-manifest.json` 中定位相关条目，并引用其中的 canonical URL。
2. 在宣称某个 frontend 能力已支持或被排除前，检查 `capabilities.json`。
3. 对 RSC、Server Functions、Server Actions、PPR 和 bundler 假设，不要从 React、SSR、Suspense 或
   Streaming SSR 推断，必须阅读[前端边界与路线图](/zh/frontend/boundaries-and-roadmap)。
4. 用 `ai-gold-questions.json` 做基于文档的回答回归集；没有来源的“看起来合理”答案不应被接受。

## 度量是可选且隐私优先的

VextJS 不会为这个文档站内置 tracker、analytics SDK、collector endpoint、cookie 或 identity graph。
事件 schema 只允许记录页面、locale、事件类型、referrer class、可选的搜索长度和 CTA 类型；明确排除了原始
搜索文本、URL query 值、凭据、页面内容和用户身份。

站点所有者如需后续接入 collector，必须先选择 provider、legal basis、retention、consent 行为和安全评审。
这些 JSON 文件只定义实现可以度量什么，不代表可以直接采集数据，也不能单独用于推断收入或转化。

需要反馈文档缺口时，请发起
[GitHub Discussion](https://github.com/devcodex-labs/vextjs/discussions)。

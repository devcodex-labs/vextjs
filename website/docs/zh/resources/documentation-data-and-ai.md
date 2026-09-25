---
title: 文档数据与 AI
description: 文档身份、规则索引、语言与快照合同，以及未来知识图谱的文档引用边界。
---

# 文档数据与 AI

VextJS 同时提供面向读者的文档页面和确定性的构建产物。这样能让搜索、AI 辅助分析和文档质量检查更可靠，
正文知识由 website/docs 维护；机器产物帮助定位与校验引用，不能替代阅读正文和核对实现。

本页面向搜索、AI 回答和未来知识图谱的开发者。先选资产，再按身份与快照读取，最后验证回答边界。当前交付文档侧合同，不表示已经实现 Capability Graph 或项目合规检查。

## 公开机器可读资产

以下链接为正式站点地址。中文预览阶段应读取对应本地构建中的文件，不假定线上已部署当前改造；接入时先检查实际 schemaVersion、rollout 与 verification。

| 资产                                                                                                      | 用途                                                                          |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`docs-manifest.json`](https://devcodex-labs.github.io/vextjs/docs-manifest.json)                         | vext.docs-manifest/v2；文档身份、角色、语言、URL、源文件 hash 与关系索引。    |
| [`capabilities.json`](https://devcodex-labs.github.io/vextjs/capabilities.json)                           | 既有 v1 能力摘要与 non-goal；非完整能力定义或图谱，需再读对应细节和运行限制。 |
| [`ai-gold-questions.json`](https://devcodex-labs.github.io/vextjs/ai-gold-questions.json)                 | 问题及所需文档/路由、禁止声称的边界；用于回答回归，结构校验不等于语义正确。   |
| [`zh/llms.txt`](https://devcodex-labs.github.io/vextjs/zh/llms.txt)                                       | 面向语言模型和文档工具的简体中文精选入口；它是索引，不是 crawler 控制文件。   |
| [`zh/llms-full.txt`](https://devcodex-labs.github.io/vextjs/zh/llms-full.txt)                             | 完整简体中文 URL 与摘要索引：每个公开中文文档页只出现一次。                   |
| [`llms.txt`](https://devcodex-labs.github.io/vextjs/llms.txt)                                             | 默认英文精选入口，与简体中文内容隔离。                                        |
| [`llms-full.txt`](https://devcodex-labs.github.io/vextjs/llms-full.txt)                                   | 完整英文 URL 与摘要索引：每个公开英文文档页只出现一次。                       |
| [`docs-events.schema.json`](https://devcodex-labs.github.io/vextjs/docs-events.schema.json)               | 可选的隐私保护事件合同；VextJS 没有启用 collector。                           |
| [`docs-dashboard-definition.json`](https://devcodex-labs.github.io/vextjs/docs-dashboard-definition.json) | 供未来自行选择合规 collector 的站点所有者使用的指标定义和采集边界。           |

另外，构建生成 [`spec-rules.json`](https://devcodex-labs.github.io/vextjs/spec-rules.json)，schemaVersion 为 vext.spec-rules/v1，由 Specification 正文投影规则身份、等级和链接。

manifest、rules 与 llms 索引在站点构建后生成，不含构建时间戳；固定文档源、构建合同、导航、问题集、依赖锁及站点配置时输出可重复。capabilities、问题集与度量合同是公开源资产，不应将它们误认为全部从正文自动提取。

## 语言与完整性合同

四个 `llms*.txt` 文件都是确定性生成的 UTF-8 Markdown，并以 plain text 提供。根目录文件只包含英文；
`/zh/` 下的文件只包含简体中文。`llms.txt` 刻意保持精选，帮助模型不用载入整个站点就能找到主要阅读路径；
`llms-full.txt` 则是当前 locale 的穷尽索引，每个页面都有唯一 canonical URL 和从源文档提取的摘要。
`docs-manifest.json` 仍是权威双语总清单，并记录每条 entry 的 locale 与 source hash；构建会验证每个
locale 的精确覆盖。

这里的 “full” 表示完整索引，不是复制所有页面正文。具备网页访问能力的 AI 会继续读取 canonical URL；离线工具
可以先用 manifest 和索引精确选择所需页面。这样既保持 1:1 的构建期覆盖证明，也避免把全部双语源文档一次性
塞入模型上下文。

## 文档身份与角色

manifest.entries 的核心字段：

| 字段                             | 含义与消费方式                                                           |
| -------------------------------- | ------------------------------------------------------------------------ |
| docId + locale                   | 精确唯一键；如 guide.routing + zh，不按标题猜测                          |
| role                             | specification / guide / reference / example / troubleshooting / resource |
| route / canonicalUrl             | 路由与该构建的权威公开地址，消费者直接读取                               |
| sourcePath / contentHash         | 源路径及原始文档内容 SHA-256，标识本次读到的版本                         |
| title / summary                  | 检索展示信息；摘要不是完整操作要求                                       |
| relatedDocuments                 | { docId, locale, canonicalUrl } 数组，表达内部出链与入链的并集           |
| audience / appliesTo / stability | 文档元数据，当前含路径/版本通道推导；不表示某功能已实测或项目符合规范    |

默认 docId 由去 locale 的相对 .md/.mdx 路径生成，例如 api/config.md → api.config；嵌套 index 保留其身份，首页为 index。页面移动时可用 Frontmatter docId 保留身份，不能复用旧 ID 表达无关内容。role 默认按目录分配，首页与 Benchmark 为 resource；前端边界页显式为 specification，排障页可覆盖为 troubleshooting。

同一逻辑页面的双语记录共享 docId 与 role；语言记录仍须分别取用。相对链接继承源文档位置，绝对 /guide/... 指向英文，中文应使用 /zh/guide/...。relatedDocuments 只保留文档关联并集，不保留有向依赖语义；不能据此生成 requires、conflicts、implements 等能力关系。

## 规则引用

[开发规范](/zh/specification/)使用稳定 Rule ID。概念上称 ruleId，在 spec-rules.json 的 rules 数组中实际字段名为 **id**，记录唯一键是 (id, locale)。每条包含 level、title、docId、canonicalUrl、anchor、ruleUrl 和 contentHash。

- 正文标题格式为 `### VEXT-HTTP-001 [MUST] 标题`，前面是与 ID 小写相同的显式锚点；类型前缀支持 ARCH/HTTP/CONTRACT/DATA/SEC/RESOURCE/JOB/OPS。
- level 序列化为 must / must-not / should / may。先读完整适用条件，不把所有 MUST 当作已有自动检查器。
- 规则 hash 包含规则标题和正文（含代码），不是整个页面 hash；两者用途不同。
- 规则移动保留 ID；拆分、删除要同步引用，不把失效 ID 自动解析到相似标题。

例：需要校验与业务边界时，在 zh locale 中读取 docId=specification.validation-and-contracts，并在同一快照的 rules 中查找 id=VEXT-CONTRACT-001，确认 docId 相同后使用 ruleUrl。正文见[校验与数据契约](/zh/specification/validation-and-contracts#vext-contract-001)。

## 同一快照与阶段

manifest 和 rules 顶层共享 documentationRevision、rollout、verification、frameworkVersion。documentationRevision 是源路径/内容 hash 及相关构建合同输入的 SHA-256；框架版本号不能代替文档修订号。任何一边的 revision 不同都不能联接，即使 docId 恰好相同。

| 项目                     | 接入要求                                                  |
| ------------------------ | --------------------------------------------------------- |
| rollout=zh-routing-pilot | 中文路由试点，只能本地/开发审阅                           |
| rollout=zh-complete      | 中文完整阶段，英文仍可待翻译；不能声称完整双语镜像通过    |
| rollout=final            | 双语收口阶段，仍要核对完整验证结果                        |
| verification.scope=page  | 单篇检查；带 sourcePath，不等于全站验收                   |
| verification.scope=stage | 整阶段检查；只有 final + stage 且发布门禁通过才可正式发布 |

两种中文阶段及任何 page 范围均不可发布。开发图谱消费逻辑时可显式使用中文阶段快照，但应保留该限制；不要把 manifest 中存在英文条目理解成英文内容已按本轮复审。

建议引用顺序：先验证 schema 和阶段/范围 → 确认两份 revision 相等 → 用 (docId, locale) 唯一定位 → 如引用规则，再校验 (id, locale) 与 docId → 读取该版本正文与规则 URL。缺文档、错语言、失效规则或混快照均应显式失败，不静默切换语言或猜测近似页面。

## 未来知识图谱如何接入

| 信息                               | 责任来源                                                 |
| ---------------------------------- | -------------------------------------------------------- |
| 解释、步骤、例子和已知限制         | website/docs 正文                                        |
| 稳定文档引用                       | manifest v2 的 docId/locale 与 URL                       |
| 框架规则身份                       | Specification Rule ID / spec-rules.json                  |
| 能力定义、能力关系、机器 whenToUse | 未来 Capability Definition，当前未实现                   |
| 项目实际使用了什么                 | 未来/对应 Project Inspector 的项目证据，不从官网说明推定 |
| 项目代码是否合规                   | Compliance / Diagnostics，不由文档链接直接证明           |

文档侧准备度要求身份可解析、答案有正文支撑、默认与失败边界明确、规则/链接有效、产物同快照。它不是“框架所有运行缺陷已关闭”或“项目已经具备某能力”的认证。例如配置声明但未接入的前端选项、外部插件 peer 兼容前提和历史 Benchmark 都必须连同限制引用。

不在 Markdown 增加 capability ID 或维护第二份机器 whenToUse，不将现有 capabilities.json 扩写成图谱，也不通过复制/迁移 Knowledge 来接入。未来消费者应引用本站正文和稳定标识，并拥有自己的能力契约。

## AI 回答应如何使用文档

1. 先按上面的 schema、阶段和快照要求，在 manifest 中精确定位语言条目，读取正文并引用 canonicalUrl。
2. capabilities.json 仅作检索摘要；在宣称能力可用前读取对应细节、条件和限制，不能只凭 supported 标签回答。
3. 对 RSC、Server Functions、Server Actions、PPR 和 bundler 假设，不要从 React、SSR、Suspense 或
   Streaming SSR 推断，必须阅读[前端边界与路线图](/zh/frontend/boundaries-and-roadmap)。
4. 用 ai-gold-questions.json 做回答回归。当前中文题的 requiredDocIds 应在题目 locale 精确解析，得到的路由集合与 requiredRoutes 相等；最终双语阶段还检查镜像等价。结构通过后仍由 AI Review 判断正文是否回答问题、是否违反 mustNotClaim，不能只数链接。

维护者可运行已有 npm run verify:docs-contract、站点 build 与 verify:docs-rendered，显式指定相同 rollout；阶段结束不带 --page。既有测试覆盖缺文档、错语言、失效规则、混快照及关系缺边/多边等负例。构建通过不替代内容 Review，也不要求为每个页面另写脚本模拟语义审查。

## 度量是可选且隐私优先的

VextJS 不会为这个文档站内置 tracker、analytics SDK、collector endpoint、cookie 或 identity graph。
事件 schema 定义页面、locale、事件类型、referrer class、可选搜索长度和 CTA 类型，并拒绝额外字段。采集策略排除原始搜索文本、URL query 值、凭据、页面内容和用户身份；schema 不会自动净化字符串，若未来实现采集端，仍须把 page 规范化为无 query 的路径并执行这些策略。

站点所有者如需后续接入 collector，必须先选择 provider、legal basis、retention、consent 行为和安全评审。
这些 JSON 文件只定义实现可以度量什么，不代表可以直接采集数据，也不能单独用于推断收入或转化。

需要反馈文档缺口时，请发起
[GitHub Discussion](https://github.com/devcodex-labs/vextjs/discussions)。

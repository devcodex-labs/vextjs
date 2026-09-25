---
title: 支持与服务
description: 使用咨询、问题反馈、生产评审和迁移协作的沟通入口与服务边界。
---

# 支持与服务

VextJS 保持 Apache-2.0，公开文档也持续开放。需要将框架用于生产场景的团队，可以通过
[GitHub Discussions](https://github.com/devcodex-labs/vextjs/discussions)
与 maintainer 发起范围沟通。

## 先选择入口

| 目的                     | 入口                                                                          | 建议提供                                           |
| ------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------- |
| 使用问题或方案讨论       | [Discussions](https://github.com/devcodex-labs/vextjs/discussions)            | 使用目标、已尝试的文档步骤与具体疑问               |
| 可复现故障或文档错误     | [Issues](https://github.com/devcodex-labs/vextjs/issues)                      | 版本、最小复现、预期与实际结果；文档问题附页面链接 |
| 提交代码或文档改进       | [贡献指南](https://github.com/devcodex-labs/vextjs/blob/main/CONTRIBUTING.md) | 修改范围、理由及相关验证结果                       |
| 生产评审、迁移或团队协作 | 下方范围沟通                                                                  | 目标、现状、约束和期望时间                         |

常规排查可先从[错误处理](/zh/guide/error-handling)、[前端排错](/zh/frontend/troubleshooting)或[部署指南](/zh/guide/deployment)开始。

## 适合的协作方向

- **架构与上线评审**：在生产上线前评估 routing、adapter 选择、validation、OpenAPI、cache、
  security、deployment 与 frontend 边界。
- **迁移与集成冲刺**：规划或结对完成既有 Node.js 服务迁移、adapter 集成，或 React 前端接入，
  同时避免出现第二套路由模型。
- **团队赋能与故障准备**：建立工程约定、测试策略、build/deploy 检查，以及适合 Vext runtime 的
  实操 runbook。

## 如何发起有效沟通

在 discussion 中说明 VextJS 版本、Node.js 版本、adapter、部署形态和希望达成的结果。不要发布
凭据、客户数据或生产 secret。可补充操作系统、最小复现、预期与实际结果，以及已经运行的验证。范围沟通后再确认是否继续及所用渠道，不把公开发帖视为服务已经接受。

<a className="vext-button vext-button--primary" href="https://github.com/devcodex-labs/vextjs/discussions">发起范围沟通</a>

## 明确边界

本页是沟通入口，不是公开价目表或 SLA。可用性、范围、费用、时间线、响应条款和私有沟通渠道都要在
协作开始前达成约定。一次支持沟通不会改变 VextJS 的公开 API、许可证或已支持的前端边界。

准备评审前，可先阅读[前端边界与路线图](/zh/frontend/boundaries-and-roadmap)和[部署](/zh/guide/deployment)。

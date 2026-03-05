import * as path from "node:path";
import { defineConfig } from "rspress/config";

export default defineConfig({
  root: path.join(__dirname, "docs"),
  title: "VextJS",
  description:
    "一个现代化的 Node.js Web 框架，开箱即用，专为构建高性能 RESTful API 而设计。",
  outDir: "dist",
  themeConfig: {
    nav: [
      {
        text: "指南",
        link: "/guide/introduction",
        activeMatch: "/guide/",
      },
      {
        text: "API 参考",
        link: "/api/config",
        activeMatch: "/api/",
      },
      {
        text: "示例",
        link: "/examples/hello-world",
        activeMatch: "/examples/",
      },
      {
        text: "v0.1.0",
        items: [
          {
            text: "更新日志",
            link: "https://github.com/vextjs/vext/blob/main/CHANGELOG.md",
          },
          {
            text: "贡献指南",
            link: "https://github.com/vextjs/vext/blob/main/CONTRIBUTING.md",
          },
        ],
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "开始",
          items: [
            { text: "介绍", link: "/guide/introduction" },
            { text: "快速开始", link: "/guide/quick-start" },
            { text: "项目结构", link: "/guide/project-structure" },
          ],
        },
        {
          text: "核心概念",
          items: [
            { text: "路由", link: "/guide/routing" },
            { text: "服务层", link: "/guide/services" },
            { text: "中间件", link: "/guide/middleware" },
            { text: "插件", link: "/guide/plugins" },
            { text: "参数校验", link: "/guide/validation" },
            { text: "配置", link: "/guide/configuration" },
          ],
        },
        {
          text: "进阶",
          items: [
            { text: "Adapter 架构", link: "/guide/adapters" },
            { text: "OpenAPI 文档", link: "/guide/openapi" },
            { text: "测试", link: "/guide/testing" },
            { text: "CLI 命令", link: "/guide/cli" },
            { text: "热重载", link: "/guide/hot-reload" },
            { text: "Cluster 多进程", link: "/guide/cluster" },
            { text: "国际化 (i18n)", link: "/guide/i18n" },
          ],
        },
      ],
      "/api/": [
        {
          text: "API 参考",
          items: [
            { text: "配置项", link: "/api/config" },
            { text: "路由定义", link: "/api/route-definition" },
            { text: "请求与响应", link: "/api/context" },
            { text: "应用实例", link: "/api/app" },
            { text: "插件 API", link: "/api/plugin-api" },
            { text: "测试工具", link: "/api/testing-api" },
          ],
        },
      ],
      "/examples/": [
        {
          text: "示例",
          items: [
            { text: "Hello World", link: "/examples/hello-world" },
            { text: "CRUD API", link: "/examples/crud-api" },
            { text: "Zod 校验集成", link: "/examples/zod-validation" },
            { text: "Drizzle ORM 集成", link: "/examples/drizzle-orm" },
            { text: "Prisma ORM 集成", link: "/examples/prisma-orm" },
          ],
        },
      ],
    },
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/vextjs/vext",
      },
    ],
    footer: {
      message: "Released under the MIT License.",
    },
    lastUpdated: true,
    outline: true,
    prevPageText: "上一篇",
    nextPageText: "下一篇",
    searchPlaceholderText: "搜索文档...",
  },
});

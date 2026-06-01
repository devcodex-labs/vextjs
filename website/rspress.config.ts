import * as path from "node:path";
import { defineConfig } from "@rspress/core";
import { pluginSitemap } from "@rspress/plugin-sitemap";

const DEFAULT_DOCS_BASE = "/vext/";
const DEFAULT_DOCS_SITE_URL = "https://vextjs.github.io/vext";

function normalizeDocsBase(value?: string) {
  const raw = value?.trim() || DEFAULT_DOCS_BASE;
  if (raw === "/") {
    return "/";
  }

  const trimmed = raw.replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/g, "");
}

const docsBase = normalizeDocsBase(process.env.VEXT_DOCS_BASE);
const docsSiteUrl = trimTrailingSlash(
  process.env.VEXT_DOCS_SITE_URL || DEFAULT_DOCS_SITE_URL,
);

export default defineConfig({
  root: path.join(__dirname, "docs"),
  base: docsBase,
  title: "VextJS",
  icon: "/favicon.svg",
  description:
    "vextjs 是一个现代化的全栈框架，旨在提高开发效率。它提供开箱即用的功能和默认配置，使开发人员能够快速启动项目，使其成为构建高性能 RESTful API 的理想选择。",
  outDir: "dist",
  head: [
    [
      "meta",
      {
        name: "google-site-verification",
        content: "eYbt9ZyPTFQHdpEJ8Iujlb9ndhmAcMlstxZd6106840",
      },
    ],
  ],
  plugins: [
    pluginSitemap({
      siteUrl: docsSiteUrl,
    }),
  ],
  search: {
    codeBlocks: true,
  },
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
        text: "Benchmark",
        link: "/benchmark",
        activeMatch: "/benchmark",
      },
      {
        text: "v0.3.11",
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
            { text: "路由缓存", link: "/guide/cache" },
            { text: "配置", link: "/guide/configuration" },
          ],
        },
        {
          text: "进阶",
          items: [
            { text: "数据库 (MonSQLize)", link: "/guide/database" },
            { text: "内置 HTTP 客户端", link: "/guide/fetch" },
            { text: "日志", link: "/guide/logger" },
            { text: "请求上下文", link: "/guide/request-context" },
            { text: "Adapter 架构", link: "/guide/adapters" },
            { text: "OpenAPI 文档", link: "/guide/openapi" },
            { text: "测试", link: "/guide/testing" },
            { text: "CLI 命令", link: "/guide/cli" },
            { text: "构建", link: "/guide/build" },
            { text: "部署与生产环境", link: "/guide/deployment" },
            { text: "热重载", link: "/guide/hot-reload" },
            { text: "预加载 (Preload)", link: "/guide/preload" },
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
            { text: "Fetch API", link: "/api/fetch" },
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
        {
          text: "生态集成",
          items: [
            { text: "Nacos 接入", link: "/examples/nacos-integration" },
            { text: "OpenTelemetry 可观测性", link: "/examples/opentelemetry" },
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
  },
});

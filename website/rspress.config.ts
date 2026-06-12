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
const docsHomeUrl = `${docsSiteUrl}/`;
const docsOgImage = `${docsSiteUrl}/og-card.svg`;

export default defineConfig({
  root: path.join(__dirname, "docs"),
  base: docsBase,
  title: "VextJS",
  logo: "/logo.svg",
  logoText: "VextJS",
  icon: "/favicon.svg",
  description:
    "VextJS 是面向 Node.js API 的高性能服务端框架，提供 Native fast path、三段式热重载、CLI、校验、OpenAPI 与生产部署能力。",
  outDir: "dist",
  head: [
    [
      "meta",
      {
        name: "google-site-verification",
        content: "eYbt9ZyPTFQHdpEJ8Iujlb9ndhmAcMlstxZd6106840",
      },
    ],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "VextJS" }],
    [
      "meta",
      {
        property: "og:description",
        content:
          "High-performance Node.js API framework with a native fast path, three-tier hot reload, CLI, OpenAPI and production-ready runtime features.",
      },
    ],
    ["meta", { property: "og:url", content: docsHomeUrl }],
    ["meta", { property: "og:image", content: docsOgImage }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
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
    darkMode: false,
    nav: [
      {
        text: "开始",
        link: "/guide/introduction",
        activeMatch: "^/guide/(introduction|quick-start|project-structure)",
      },
      {
        text: "运行时",
        link: "/guide/routing",
        activeMatch:
          "^/guide/(routing|services|middleware|plugins|hooks|request-context|configuration|adapters)",
      },
      {
        text: "生产",
        link: "/guide/deployment",
        activeMatch:
          "^/guide/(build|deployment|testing|cli|hot-reload|preload|cluster|i18n|logger|error-handling|validation|cache|database|fetch|openapi)",
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
        text: "v0.3.24",
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
          text: "运行时",
          items: [
            { text: "路由", link: "/guide/routing" },
            { text: "服务层", link: "/guide/services" },
            { text: "中间件", link: "/guide/middleware" },
            { text: "插件", link: "/guide/plugins" },
            { text: "运行时 Hooks", link: "/guide/hooks" },
            { text: "请求上下文", link: "/guide/request-context" },
            { text: "配置", link: "/guide/configuration" },
            { text: "Adapter 架构", link: "/guide/adapters" },
          ],
        },
        {
          text: "数据与接口",
          items: [
            { text: "参数校验", link: "/guide/validation" },
            { text: "响应缓存", link: "/guide/cache" },
            { text: "数据库 (MonSQLize)", link: "/guide/database" },
            { text: "内置 HTTP 客户端", link: "/guide/fetch" },
            { text: "OpenAPI 文档", link: "/guide/openapi" },
          ],
        },
        {
          text: "交付与生产",
          items: [
            { text: "构建", link: "/guide/build" },
            { text: "部署与生产环境", link: "/guide/deployment" },
            { text: "测试", link: "/guide/testing" },
            { text: "CLI 命令", link: "/guide/cli" },
            { text: "热重载", link: "/guide/hot-reload" },
            { text: "预加载 (Preload)", link: "/guide/preload" },
            { text: "Cluster 多进程", link: "/guide/cluster" },
            { text: "国际化 (i18n)", link: "/guide/i18n" },
            { text: "日志", link: "/guide/logger" },
            { text: "错误处理", link: "/guide/error-handling" },
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
      message: "Released under the Apache-2.0 License.",
    },
    lastUpdated: true,
  },
});

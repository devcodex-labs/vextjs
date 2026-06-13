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

type SidebarGroup = {
  text: string;
  items: Array<{
    text: string;
    link: string;
  }>;
};

type NavItemSource =
  | {
      en: string;
      zh: string;
      link: string;
      activeMatch?: string;
    }
  | {
      en: string;
      zh: string;
      items: Array<{
        en: string;
        zh: string;
        link: string;
      }>;
    };

const localizeLink = (link: string, language: "en" | "zh") => {
  if (language === "en" || /^https?:\/\//.test(link)) {
    return link;
  }

  return link === "/" ? "/zh/" : `/zh${link}`;
};

const localizeActiveMatch = (
  activeMatch: string | undefined,
  language: "en" | "zh",
) => {
  if (!activeMatch || language === "en") {
    return activeMatch;
  }

  if (activeMatch.startsWith("^/")) {
    return activeMatch.replace("^/", "^/zh/");
  }

  if (activeMatch.startsWith("/")) {
    return `/zh${activeMatch}`;
  }

  return activeMatch;
};

const navSource: NavItemSource[] = [
  {
    en: "Guide",
    zh: "指南",
    link: "/guide/introduction",
    activeMatch: "^/guide/(introduction|quick-start|project-structure)",
  },
  {
    en: "Runtime",
    zh: "运行时",
    link: "/guide/routing",
    activeMatch:
      "^/guide/(routing|services|middleware|plugins|hooks|request-context|configuration|adapters)",
  },
  {
    en: "Data",
    zh: "数据",
    link: "/guide/validation",
    activeMatch: "^/guide/(validation|cache|database|fetch|openapi)",
  },
  {
    en: "Production",
    zh: "生产",
    link: "/guide/deployment",
    activeMatch:
      "^/guide/(build|deployment|testing|cli|hot-reload|preload|cluster|i18n|logger|error-handling)",
  },
  {
    en: "API Reference",
    zh: "API 参考",
    link: "/api/config",
    activeMatch: "/api/",
  },
  {
    en: "Examples",
    zh: "示例",
    link: "/examples/hello-world",
    activeMatch: "/examples/",
  },
  {
    en: "Benchmark",
    zh: "基准测试",
    link: "/benchmark",
    activeMatch: "/benchmark",
  },
  {
    en: "v0.3.25",
    zh: "v0.3.25",
    items: [
      {
        en: "Changelog",
        zh: "更新日志",
        link: "https://github.com/vextjs/vext/blob/main/CHANGELOG.md",
      },
      {
        en: "Contributing",
        zh: "贡献指南",
        link: "https://github.com/vextjs/vext/blob/main/CONTRIBUTING.md",
      },
    ],
  },
];

const createNav = (language: "en" | "zh") =>
  navSource.map((item) => {
    if ("items" in item) {
      return {
        text: item[language],
        items: item.items.map((child) => ({
          text: child[language],
          link: localizeLink(child.link, language),
        })),
      };
    }

    return {
      text: item[language],
      link: localizeLink(item.link, language),
      activeMatch: localizeActiveMatch(item.activeMatch, language),
    };
  });

const englishNav = createNav("en");
const chineseNav = createNav("zh");

const englishSidebar: SidebarGroup[] = [
  {
    text: "Start",
    items: [
      { text: "Introduction", link: "/guide/introduction" },
      { text: "Quick Start", link: "/guide/quick-start" },
      { text: "Project Structure", link: "/guide/project-structure" },
    ],
  },
  {
    text: "Runtime",
    items: [
      { text: "Routing", link: "/guide/routing" },
      { text: "Services", link: "/guide/services" },
      { text: "Middleware", link: "/guide/middleware" },
      { text: "Plugins", link: "/guide/plugins" },
      { text: "Runtime Hooks", link: "/guide/hooks" },
      { text: "Request Context", link: "/guide/request-context" },
      { text: "Configuration", link: "/guide/configuration" },
      { text: "Adapter Architecture", link: "/guide/adapters" },
    ],
  },
  {
    text: "Data and APIs",
    items: [
      { text: "Validation", link: "/guide/validation" },
      { text: "Response Cache", link: "/guide/cache" },
      { text: "Database", link: "/guide/database" },
      { text: "HTTP Client", link: "/guide/fetch" },
      { text: "OpenAPI", link: "/guide/openapi" },
    ],
  },
  {
    text: "Production",
    items: [
      { text: "Build", link: "/guide/build" },
      { text: "Deployment", link: "/guide/deployment" },
      { text: "Testing", link: "/guide/testing" },
      { text: "CLI Commands", link: "/guide/cli" },
      { text: "Hot Reload", link: "/guide/hot-reload" },
      { text: "Preload", link: "/guide/preload" },
      { text: "Cluster", link: "/guide/cluster" },
      { text: "Internationalization (i18n)", link: "/guide/i18n" },
      { text: "Logger", link: "/guide/logger" },
      { text: "Error Handling", link: "/guide/error-handling" },
    ],
  },
  {
    text: "API Reference",
    items: [
      { text: "Config", link: "/api/config" },
      { text: "Route Definition", link: "/api/route-definition" },
      { text: "Request and Response", link: "/api/context" },
      { text: "App", link: "/api/app" },
      { text: "Fetch API", link: "/api/fetch" },
      { text: "Plugin API", link: "/api/plugin-api" },
      { text: "Testing API", link: "/api/testing-api" },
      { text: "Access Log", link: "/api/access-log" },
    ],
  },
  {
    text: "Examples",
    items: [
      { text: "Hello World", link: "/examples/hello-world" },
      { text: "CRUD API", link: "/examples/crud-api" },
      { text: "Zod Validation", link: "/examples/zod-validation" },
      { text: "Drizzle ORM", link: "/examples/drizzle-orm" },
      { text: "Prisma ORM", link: "/examples/prisma-orm" },
    ],
  },
  {
    text: "Ecosystem Integrations",
    items: [
      { text: "Nacos", link: "/examples/nacos-integration" },
      { text: "OpenTelemetry", link: "/examples/opentelemetry" },
    ],
  },
];

const chineseSidebar: SidebarGroup[] = [
  {
    text: "开始",
    items: [
      { text: "介绍", link: "/zh/guide/introduction" },
      { text: "快速开始", link: "/zh/guide/quick-start" },
      { text: "项目结构", link: "/zh/guide/project-structure" },
    ],
  },
  {
    text: "运行时",
    items: [
      { text: "路由", link: "/zh/guide/routing" },
      { text: "服务层", link: "/zh/guide/services" },
      { text: "中间件", link: "/zh/guide/middleware" },
      { text: "插件", link: "/zh/guide/plugins" },
      { text: "运行时 Hooks", link: "/zh/guide/hooks" },
      { text: "请求上下文", link: "/zh/guide/request-context" },
      { text: "配置", link: "/zh/guide/configuration" },
      { text: "Adapter 架构", link: "/zh/guide/adapters" },
    ],
  },
  {
    text: "数据与接口",
    items: [
      { text: "参数校验", link: "/zh/guide/validation" },
      { text: "响应缓存", link: "/zh/guide/cache" },
      { text: "数据库 (MonSQLize)", link: "/zh/guide/database" },
      { text: "内置 HTTP 客户端", link: "/zh/guide/fetch" },
      { text: "OpenAPI 文档", link: "/zh/guide/openapi" },
    ],
  },
  {
    text: "交付与生产",
    items: [
      { text: "构建", link: "/zh/guide/build" },
      { text: "部署与生产环境", link: "/zh/guide/deployment" },
      { text: "测试", link: "/zh/guide/testing" },
      { text: "CLI 命令", link: "/zh/guide/cli" },
      { text: "热重载", link: "/zh/guide/hot-reload" },
      { text: "预加载 (Preload)", link: "/zh/guide/preload" },
      { text: "Cluster 多进程", link: "/zh/guide/cluster" },
      { text: "国际化 (i18n)", link: "/zh/guide/i18n" },
      { text: "日志", link: "/zh/guide/logger" },
      { text: "错误处理", link: "/zh/guide/error-handling" },
    ],
  },
  {
    text: "API 参考",
    items: [
      { text: "配置项", link: "/zh/api/config" },
      { text: "路由定义", link: "/zh/api/route-definition" },
      { text: "请求与响应", link: "/zh/api/context" },
      { text: "应用实例", link: "/zh/api/app" },
      { text: "Fetch API", link: "/zh/api/fetch" },
      { text: "插件 API", link: "/zh/api/plugin-api" },
      { text: "测试工具", link: "/zh/api/testing-api" },
      { text: "Access Log 中间件", link: "/zh/api/access-log" },
    ],
  },
  {
    text: "示例",
    items: [
      { text: "Hello World", link: "/zh/examples/hello-world" },
      { text: "CRUD API", link: "/zh/examples/crud-api" },
      { text: "Zod 校验集成", link: "/zh/examples/zod-validation" },
      { text: "Drizzle ORM 集成", link: "/zh/examples/drizzle-orm" },
      { text: "Prisma ORM 集成", link: "/zh/examples/prisma-orm" },
    ],
  },
  {
    text: "生态集成",
    items: [
      { text: "Nacos 接入", link: "/zh/examples/nacos-integration" },
      { text: "OpenTelemetry 可观测性", link: "/zh/examples/opentelemetry" },
    ],
  },
];

export default defineConfig({
  root: path.join(__dirname, "docs"),
  base: docsBase,
  lang: "en",
  title: "VextJS",
  logo: "/logo.svg",
  logoText: "VextJS",
  icon: "/favicon.svg",
  description:
    "High-performance Node.js API framework with a native fast path, schema-dsl validation, OpenAPI, hot reload, and production runtime features.",
  locales: [
    {
      lang: "en",
      label: "English",
      title: "VextJS",
      description:
        "High-performance Node.js API framework with native routing, schema-dsl validation, OpenAPI, and production runtime features.",
    },
    {
      lang: "zh",
      label: "简体中文",
      title: "VextJS",
      description:
        "VextJS 是面向 Node.js API 的高性能服务端框架，提供 Native fast path、三段式热重载、CLI、校验、OpenAPI 与生产部署能力。",
    },
  ],
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
  languageParity: {
    enabled: true,
  },
  themeConfig: {
    darkMode: false,
    nav: englishNav,
    locales: [
      {
        lang: "en",
        label: "English",
        title: "VextJS",
        description:
          "High-performance Node.js API framework with native routing, schema-dsl validation, OpenAPI, and production runtime features.",
        nav: englishNav,
        sidebar: {
          "/": englishSidebar,
        },
        footer: {
          message: "Released under the Apache-2.0 License.",
        },
      },
      {
        lang: "zh",
        label: "简体中文",
        title: "VextJS",
        description:
          "VextJS 是面向 Node.js API 的高性能服务端框架，提供 Native fast path、三段式热重载、CLI、校验、OpenAPI 与生产部署能力。",
        nav: chineseNav,
        sidebar: {
          "/zh/": chineseSidebar,
        },
        footer: {
          message: "基于 Apache-2.0 License 发布。",
        },
      },
    ],
    sidebar: {
      "/": englishSidebar,
      "/zh/": chineseSidebar,
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

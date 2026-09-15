import {
  RecipeContext,
  safeModulePath,
  pascalName,
  indent,
} from "./recipe-context.js";
import {
  projectRouteFilePrefix,
  normalizeRegisteredRoutePath,
} from "../lib/route-contract.js";
import type { VextMcpChangeSetFile } from "./change-set.js";
import { buildRouteOptions, renderCodeValue } from "./route-options.js";

export function renderFrontendRecipe(
  name: string,
  ctx: RecipeContext,
): VextMcpChangeSetFile[] {
  ctx.prerequisites.push(
    "Enable the project's frontend, confirm React/ReactDOM and JSX compilation, and verify SSR/hydration in a browser. Backend API-only projects need frontend setup before running these files.",
  );
  if (name === "frontend-layout") {
    const reusable = ctx.option("reusable", false);
    const role = reusable ? "frontend-layouts" : "frontend-pages";
    const ts = ctx.language(role) === "ts";
    const page = safeModulePath(ctx.option("page", ctx.name));
    const file = reusable
      ? `${ctx.role(role)}/${pascalName(ctx.name)}Layout.${ts ? "tsx" : "jsx"}`
      : `${ctx.role(role)}/${page}/layout.${ts ? "tsx" : "jsx"}`;
    const source = `${ts ? `import type { ReactNode } from ${ctx.quote("react")};\n\n` : ""}${ctx.comment("布局必须保留 children；只有页面目录的 layout 入口参与自动布局发现。", "Preserve children; only layout entrypoints under the pages directory participate in automatic layout discovery.")}${!ts ? "/** @param {{ children?: import('react').ReactNode }} props */\n" : ""}export default function ${pascalName(ctx.name)}Layout({ children }${ts ? ": { children?: ReactNode }" : ""}) {\n  return <div data-layout=${JSON.stringify(ctx.name)}>{children}</div>;\n}\n`;
    ctx.steps.push(
      reusable
        ? `Import ${file} from a real page layout entrypoint and pass children through.`
        : `Confirm that ${page} has a page consumer and that its nested layout renders the page once.`,
    );
    return [
      ctx.file(file, source, "Create a layout that preserves page content."),
    ];
  }
  if (name === "frontend-component") {
    const ts = ctx.language("frontend-components") === "ts";
    const component =
      ctx.project.policy.patch.naming?.component === "preserve"
        ? ctx.input.name
        : pascalName(ctx.name);
    const file = `${ctx.role("frontend-components")}/${component}.${ts ? "tsx" : "jsx"}`;
    return [
      ctx.file(
        file,
        `${ctx.comment("可复用展示组件；仅在出现实际交互或复用边界时增加状态与抽象。", "Reusable presentation component; add state and abstractions only for actual interaction or reuse.")}${!ts ? "/** @param {{ title?: string }} props */\n" : ""}export function ${component}(props${ts ? ": { title?: string }" : ""}) {\n  return (\n    <section>\n      <h2>{props.title ?? ${ctx.quote(ctx.option("title", pascalName(ctx.name)))}}</h2>\n    </section>\n  );\n}\n`,
        "Create a presentation component with an explicit props boundary.",
      ),
    ];
  }
  const page = safeModulePath(ctx.option("page", ctx.name));
  const routeFile = ctx.filePath("routes");
  const ts = ctx.language("frontend-pages") === "ts";
  const pageFile = `${ctx.role("frontend-pages")}/${page}.${ts ? "tsx" : "jsx"}`;
  const props = ctx.option("props", { title: pascalName(ctx.name) });
  const pageRouteOptions = buildRouteOptions(ctx, {
    summary: `Render ${page}`,
  });
  const route = ctx.file(
    routeFile,
    `import { defineRoutes } from ${ctx.quote("vextjs")};\n\n${ctx.comment("只把可序列化的页面数据传给前端；权限与缓存策略在读取数据前确定。", "Pass serializable page data; establish authorization and cache policy before reading protected data.")}export default defineRoutes((app) => {\n  app.get(\n    ${ctx.quote(ctx.option("path", "/"))},\n${indent(renderCodeValue(ctx, pageRouteOptions), 4)},\n    (_req, res) => {\n      res.render(${ctx.quote(page)}, ${JSON.stringify(props, null, 2).replaceAll("\n", "\n      ")});\n    },\n  );\n});\n`,
    "Render the actual generated frontend page.",
  );
  const files = ctx.loaderFacade("routes", route);
  let pageSource: string;
  const signature = `${!ts ? "/** @param {Record<string, unknown>} props */\n" : ""}export default function ${pascalName(ctx.name)}Page(props${ts ? ": Record<string, unknown>" : ""})`;
  if (name === "page-and-api") {
    const apiLocalPath = ctx.option("apiPath", "/");
    const apiName = `${ctx.name}-api`;
    const apiFile = `${ctx.role("routes")}/${apiName}.${ctx.language("routes")}`;
    // 文件前缀是实际 URL 的组成部分，页面请求和路由声明使用同一个值。

    const apiRouteOptions = buildRouteOptions(ctx, {
      summary: `Read ${ctx.name} page data`,
      responses: ctx.option("apiResponses", {
        200: { schema: { resource: "string!" } },
      }),
      sourceKey: "apiRouteOptions",
      includeTopLevel: false,
    });
    const api = ctx.file(
      apiFile,
      `import { defineRoutes } from ${ctx.quote("vextjs")};\n\n${ctx.comment("页面数据 API 必须声明响应契约；权限与缓存配置通过 apiRouteOptions 显式传入。", "Declare the page data API response contract; pass authorization and cache policy explicitly through apiRouteOptions.")}export default defineRoutes((app) => {\n  app.get(\n    ${ctx.quote(apiLocalPath)},\n${indent(renderCodeValue(ctx, apiRouteOptions), 4)},\n    (_req, res) => {\n      res.json({ resource: ${ctx.quote(ctx.name)} });\n    },\n  );\n});\n`,
      "Create the API called by the page, with an explicit response contract.",
    );
    const apiFiles = ctx.loaderFacade("routes", api, apiName);
    files.push(...apiFiles);
    const runtimeRoot = ctx.runtimeRoot("routes");
    const entry = apiFiles.find((file) =>
      file.path.startsWith(runtimeRoot + "/"),
    )!;
    const url = normalizeRegisteredRoutePath(
      projectRouteFilePrefix(entry.path, runtimeRoot),
      apiLocalPath,
    );
    pageSource = `import { useEffect, useState } from ${ctx.quote("react")};\n\n${ctx.comment("每次请求绑定 AbortController；卸载或刷新后，旧请求不能覆盖新页面状态。", "Bind each request to an AbortController so stale requests cannot update an unmounted or refreshed page.")}${signature} {\n  const [data, setData] = useState${ts ? "<unknown>" : ""}(null);\n  const [error, setError] = useState(\"\");\n  const [pending, setPending] = useState(true);\n  const [revision, setRevision] = useState(0);\n\n  useEffect(() => {\n    const controller = new AbortController();\n    setPending(true);\n    setError(\"\");\n    void (async () => {\n      try {\n        const response = await fetch(${ctx.quote(url)}, { signal: controller.signal });\n        if (!response.ok) throw new Error(\`HTTP \${response.status}\`);\n        const body = await response.json();\n        if (!controller.signal.aborted) setData(body);\n      } catch (cause) {\n        if (!controller.signal.aborted) {\n          setError(cause instanceof Error ? cause.message : String(cause));\n        }\n      } finally {\n        if (!controller.signal.aborted) setPending(false);\n      }\n    })();\n    return () => controller.abort();\n  }, [revision]);\n\n  return (\n    <main>\n      <h1>{typeof props.title === \"string\" ? props.title : ${ctx.quote(pascalName(ctx.name))}}</h1>\n      <button type=\"button\" disabled={pending} onClick={() => setRevision((value) => value + 1)}>\n        ${ctx.message("刷新", "Refresh")}\n      </button>\n      {pending && <p role=\"status\">${ctx.message("加载中…", "Loading…")}</p>}\n      {error && <p role=\"alert\">{error}</p>}\n      {!pending && !error && <pre>{JSON.stringify(data, null, 2)}</pre>}\n    </main>\n  );\n}\n`;
    ctx.steps.push(
      `Open the page and verify its request reaches GET ${url}, then test pending, failed request and unmount cancellation. Adopt the existing generated API client when its route contract is available; do not invent an import into absent generated files.`,
    );
  } else {
    pageSource = `${signature} {\n  return (\n    <main>\n      <h1>{typeof props.title === "string" ? props.title : ${ctx.quote(pascalName(ctx.name))}}</h1>\n      <pre>{JSON.stringify(props, null, 2)}</pre>\n    </main>\n  );\n}\n`;
  }
  files.push(
    ctx.file(
      pageFile,
      pageSource,
      "Create the page consumed by res.render with serializable props.",
    ),
  );
  return files;
}

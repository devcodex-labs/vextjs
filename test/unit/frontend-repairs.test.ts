import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { buildFrontendClient } from "../../src/frontend/tooling/client-build-compiler.js";
import {
  createFrontendRenderer,
  type VextFrontendRenderer,
} from "../../src/frontend/runtime/renderer.js";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";
import {
  resolveFrontendLocale,
  applyLocaleHeaders,
} from "../../src/frontend/runtime/locale-resolution.js";
import {
  recordRequestLocale,
  negotiateLocale,
} from "../../src/lib/i18n/locale-resolution.js";
import { _validateConfig } from "../../src/lib/config-loader.js";
import type { VextRequest } from "../../src/types/request.js";

let rootDir: string;
let renderer: VextFrontendRenderer;
let build: Awaited<ReturnType<typeof buildFrontendClient>>;
const base = {
  enabled: true,
  apiClient: false,
  publicPath: "/app/",
  render: { layout: false },
  i18n: { enabled: true, defaultLocale: "inherit", inject: "all" },
} as const;
async function write(file: string, content: string | Buffer) {
  const target = path.join(rootDir, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
function request(headers: Record<string, string> = {}): VextRequest {
  return {
    headers,
    query: {},
    params: {},
    path: "/",
    url: "/",
    method: "GET",
    cookie: (key: string) => headers[`cookie-${key}`],
  } as VextRequest;
}

beforeAll(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), "vext-frontend-repairs-"));
  await symlink(
    path.resolve("node_modules"),
    path.join(rootDir, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await write(
    "src/frontend/pages/_document.html",
    "<!doctype html><html><head>{vext.styles}</head><body>{vext.root}{vext.data}{vext.entry}</body></html>",
  );
  await write(
    "src/frontend/imports/logo.png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3k0AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  await write("src/frontend/imports/font.woff2", Buffer.from("font-fixture"));
  await write(
    "src/frontend/styles/a/base.module.css",
    ".base { background-color: blue; }",
  );
  await write(
    "src/frontend/styles/a/card.module.css",
    '@import "./base.module.css"; .card { composes: base from "./base.module.css"; composes: global-card from global; color: red; } :global(.global-card) { border-width: 3px; } .default {font-weight:700} .__proto__ {padding-top:7px}',
  );
  await write(
    "src/frontend/styles/b/card.module.css",
    ".card { color: green; }",
  );
  await write(
    "src/frontend/pages/layout.tsx",
    'export default function Layout({children}) { return <section data-layout="root">{children}</section>; }',
  );
  await write(
    "src/frontend/pages/empty.tsx",
    "export default function Empty() { return null; }",
  );
  await write(
    "src/frontend/pages/index.tsx",
    `import a from "../styles/a/card.module.css"; import b from "../styles/b/card.module.css";
import logo from "../imports/logo.png"; import font from "../imports/font.woff2";
import { useVextI18n, VextPageResultError } from "vextjs/frontend";
export default function Page(props) {
  if (props.fail && typeof window === "undefined") throw new Error("SSR probe failure");
  if (props.delay && typeof window === "undefined") { const until = Date.now() + props.delay; while (Date.now() < until) {} }
  const messages = useVextI18n();
  return <main className={a.card} data-font={font} data-error-export={typeof VextPageResultError}><h1>{messages.title}</h1><img src={logo}/><aside className={b.card}>Other</aside><span id="special" className={[a.default,a.__proto__].join(" ")}>Special</span></main>;
}`,
  );
  await write("src/frontend/locales/en-US.json", '{"title":"Hello"}');
  await write("src/frontend/locales/zh-CN.json", '{"title":"中文"}');
  build = await buildFrontendClient({
    rootDir,
    mode: "production",
    config: base,
  });
  renderer = createFrontendRenderer({
    rootDir,
    mode: "production",
    config: build.config,
  });
});
afterAll(async () => {
  if (rootDir) await rm(rootDir, { recursive: true, force: true });
});

describe("frontend consumer repairs", () => {
  it("shares scoped mappings with composed classes and duplicate filenames", async () => {
    const rendered = renderer.renderPage("index");
    const classes = /<main class="([^"]+)"/.exec(rendered.html)![1]!.split(" ");
    const other = /<aside class="([^"]+)"/.exec(rendered.html)![1]!;
    const manifest = JSON.parse(await readFile(build.manifestPath!, "utf8"));
    const css = (
      await Promise.all(
        manifest.assets
          .filter((asset: { path: string }) => asset.path.endsWith(".css"))
          .map((asset: { path: string }) =>
            readFile(
              path.join(
                build.config.outDir,
                asset.path.slice(build.config.publicPath.length),
              ),
              "utf8",
            ),
          ),
      )
    ).join("\n");
    expect(classes).toHaveLength(3);
    for (const name of classes) expect(css).toContain(`.${name}`);
    expect(css).toContain(`.${other}`);
    expect(classes).not.toContain(other);
    const special = /<span id="special" class="([^"]+)"/
      .exec(rendered.html)![1]!
      .split(" ");
    expect(special).toHaveLength(2);
    for (const name of special) expect(css).toContain(`.${name}`);
    expect(rendered.html).toContain('data-error-export="function"');
    expect(rendered.payload.mountMode).toBe("server");
  });

  it("uses public browser candidates for SSR image/font imports", async () => {
    const rendered = renderer.renderPage("index");
    const manifest = JSON.parse(await readFile(build.manifestPath!, "utf8"));
    for (const extension of [".png", ".woff2"]) {
      const asset = manifest.assets.find((item: { path: string }) =>
        item.path.endsWith(extension),
      );
      expect(asset).toBeDefined();
      expect(rendered.html).toContain(asset.path);
      expect(
        await readFile(
          path.join(
            build.config.outDir,
            asset.path.slice(build.config.publicPath.length),
          ),
        ),
      ).not.toHaveLength(0);
    }
  });

  it("uses the same inline data URL and CDN URL in SSR and browser imports", async () => {
    for (const [name, assets, deploy] of [
      ["inline", { inlineLimit: 1000 }, {}],
      [
        "cdn",
        { inlineLimit: 0 },
        { assetBaseUrl: "https://cdn.example.test/app/" },
      ],
    ] as const) {
      const result = await buildFrontendClient({
        rootDir,
        mode: "production",
        config: {
          ...base,
          outDir: `dist/client-${name}`,
          build: { assets },
          deploy,
        },
      });
      const html = createFrontendRenderer({
        rootDir,
        mode: "production",
        config: result.config,
      }).renderPage("index").html;
      expect(html).toContain(
        name === "inline"
          ? "data:image/png;base64,"
          : "https://cdn.example.test/app/assets/logo-",
      );
      const manifest = JSON.parse(await readFile(result.manifestPath!, "utf8"));
      expect(
        manifest.assets.filter((item: { path: string }) =>
          item.path.endsWith(".png"),
        ),
      ).toHaveLength(name === "inline" ? 0 : 1);
    }
  });

  it("resolves global layout before HTML and envelope construction", () => {
    for (const override of [undefined, false, true, ".", ["."]] as const) {
      const result = renderer.renderPage(
        "index",
        {},
        override === undefined
          ? {}
          : { layout: override as boolean | string | string[] },
      );
      const enabled = override !== undefined && override !== false;
      expect(result.html.includes('data-layout="root"')).toBe(enabled);
      expect(result.payload.layouts).toEqual(enabled ? ["."] : []);
      expect(
        renderer.renderPageEnvelope(
          "index",
          {},
          override === undefined
            ? {}
            : { layout: override as boolean | string | string[] },
        ).envelope.result,
      ).toMatchObject({ layouts: enabled ? ["."] : [] });
    }
  });

  it("records actual SSR/CSR/fallback outcomes, including valid empty SSR", () => {
    expect(
      renderer.renderPage("index", {}, { ssr: false }).payload.mountMode,
    ).toBe("client");
    expect(renderer.renderPage("index", { fail: true }).payload.mountMode).toBe(
      "client",
    );
    expect(renderer.renderPage("empty").payload.mountMode).toBe("server");
    const clientOnly = request();
    Object.assign(clientOnly, {
      _routeOptions: { frontend: { clientOnly: true } },
    });
    expect(
      renderer.renderPage("index", {}, {}, 200, clientOnly).payload.mountMode,
    ).toBe("client");
    const timed = createFrontendRenderer({
      rootDir,
      mode: "production",
      config: { ...base, render: { layout: false, timeoutMs: 1 } },
    });
    expect(timed.renderPage("index", { delay: 10 }).payload.mountMode).toBe(
      "client",
    );
  });

  it("inherits request language and provenance in HTML and navigation", () => {
    const req = request({ "accept-language": "en;q=0.1, ZH-cn;q=0.9" });
    recordRequestLocale(req, "zh-CN", ["Accept-Language"]);
    const rendered = renderer.renderPage(
      "index",
      {},
      { headers: { vary: "Accept-Encoding" } },
      200,
      req,
    );
    expect(rendered.html).toContain('<html lang="zh-CN">');
    expect(rendered.html).toContain("中文");
    expect(rendered.headers.Vary).toContain("Accept-Language");
    expect(rendered.headers.Vary).toContain("Accept-Encoding");
    expect(rendered.payload.cache.noStore).toBe(false);
    expect(
      renderer.renderPageEnvelope("index", {}, {}, 200, req).envelope.result,
    ).toMatchObject({ locale: "zh-CN" });
    const override = renderer.renderPage(
      "index",
      {},
      { locale: "en-US" },
      200,
      req,
    );
    expect(override.html).toContain("Hello");
    expect(override.payload.cache.noStore).toBe(true);
    expect(override.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("rejects disguised SVG raster inputs without globally changing sharp", async () => {
    await write(
      "src/frontend/assets/renamed.png",
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
    );
    await expect(
      buildFrontendClient({
        rootDir,
        mode: "production",
        config: { ...base, media: { images: { enabled: true } } },
      }),
    ).rejects.toThrow("supported raster format");
  });
});

describe("locale negotiation and safe cache identity", () => {
  it("honors quality weights, case and prefix matching and rejects invalid weights", () => {
    expect(negotiateLocale("en;q=0.9,zh-CN;q=0.1", ["en-US", "zh-CN"])).toBe(
      "en-US",
    );
    expect(negotiateLocale("ZH-cn;q=0.9,en-US;q=0.1", ["en-US", "zh-CN"])).toBe(
      "zh-CN",
    );
    expect(
      negotiateLocale("en;q=0,zh;q=2,*;q=1", ["en-US", "zh-CN"]),
    ).toBeUndefined();
  });
  it("detects configured sources in order, with URL and cookie cache policies", () => {
    const config = resolveFrontendConfig(
      {
        ...base,
        i18n: {
          enabled: true,
          defaultLocale: "en-US",
          detect: ["query", "header", "cookie", "accept-language"],
        },
      },
      { rootDir, mode: "production" },
    );
    const req = request({
      "x-vext-locale": "en-US",
      "cookie-locale": "en-US",
      "accept-language": "en-US",
    });
    req.query.locale = "zh";
    expect(resolveFrontendLocale(config.i18n, ["en-US", "zh-CN"], req)).toEqual(
      { locale: "zh-CN", vary: [], noStore: false },
    );
    delete req.query.locale;
    expect(
      resolveFrontendLocale(config.i18n, ["en-US", "zh-CN"], req).vary,
    ).toEqual(["X-Vext-Locale"]);
    delete req.headers["x-vext-locale"];
    expect(resolveFrontendLocale(config.i18n, ["en-US", "zh-CN"], req)).toEqual(
      { locale: "en-US", vary: ["X-Vext-Locale", "Cookie"], noStore: true },
    );
    const headers = { Vary: "*" };
    applyLocaleHeaders(headers, {
      locale: "en-US",
      vary: ["Accept-Language"],
      noStore: false,
    });
    expect(headers.Vary).toBe("*");
  });
  it("diagnoses unsupported detect sources and validates plugin timer limits", () => {
    expect(() =>
      resolveFrontendConfig(
        { ...base, i18n: { detect: ["unsupported"] } },
        { rootDir, mode: "production" },
      ),
    ).toThrow("does not support");
    for (const value of [0, -1, Infinity, NaN, 1.5, "1", 2_147_483_648])
      expect(() =>
        _validateConfig({ plugin: { setupTimeout: value } }),
      ).toThrow("config.plugin.setupTimeout");
    expect(() =>
      _validateConfig({ plugin: { setupTimeout: 1, custom: { value: true } } }),
    ).not.toThrow();
  });
});

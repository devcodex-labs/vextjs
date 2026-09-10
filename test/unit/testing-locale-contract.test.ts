import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTestApp } from "../../src/testing/index.js";
import { loadI18n } from "../../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function project(directory = "src/locales", message = "中文消息") {
  const rootDir = await mkdtemp(join(tmpdir(), "vext-testing-locale-"));
  roots.push(rootDir);
  const locales = join(rootDir, directory, "orders/payment");
  await mkdir(locales, { recursive: true });
  const file = join(locales, "zh-CN.json");
  await writeFile(file, JSON.stringify({ declined: { code: 42001, message } }));
  return { rootDir, directory: join(rootDir, directory), file };
}
const options = {
  services: false,
  routes: false,
  middlewares: false,
  config: { locale: { default: "zh-CN" } },
} as const;
const thrown = (app: Awaited<ReturnType<typeof createTestApp>>["app"]) => {
  try {
    app.throw("orders.payment.declined");
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("app.throw did not throw");
};

describe("public app locale loading and testing parity", () => {
  it("loads default modular locales before plugins and isolates two apps", async () => {
    const first = await project();
    const second = await project("src/locales", "第二个应用");
    const a = await createTestApp({
      ...options,
      rootDir: first.rootDir,
      setupPlugins(app) {
        expect(thrown(app)).toBe("中文消息");
      },
    });
    const b = await createTestApp({ ...options, rootDir: second.rootDir });
    try {
      expect(thrown(a.app)).toBe("中文消息");
      expect(thrown(b.app)).toBe("第二个应用");
      await writeFile(first.file, "{ invalid");
      await expect(loadI18n(a.app, first.directory)).rejects.toThrow(
        /zh-CN.json/,
      );
      expect(thrown(a.app)).toBe("中文消息");
      await expect(
        loadI18n(a.app, join(first.rootDir, "missing")),
      ).resolves.toEqual([]);
      expect(thrown(a.app)).toBe("orders.payment.declined");
      expect(thrown(b.app)).toBe("第二个应用");
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("uses root-relative custom directories and rejects bad dictionaries during initialization", async () => {
    const fixture = await project("shared/messages");
    const custom = {
      ...options.config,
      locale: { ...options.config.locale, directory: "shared/messages" },
    };
    const app = await createTestApp({
      ...options,
      rootDir: fixture.rootDir,
      config: custom,
    });
    try {
      expect(thrown(app.app)).toBe("中文消息");
    } finally {
      await app.close();
    }
    await writeFile(fixture.file, "{ invalid");
    await expect(
      createTestApp({ ...options, rootDir: fixture.rootDir, config: custom }),
    ).rejects.toThrow(/zh-CN.json/);
  });

  it("executes script dictionaries but not user config providers", async () => {
    const fixture = await project();
    await mkdir(join(fixture.rootDir, "src/config"));
    await writeFile(
      join(fixture.rootDir, "src/config/default.mjs"),
      "throw new Error('config provider must not execute');",
    );
    await rm(fixture.file);
    await writeFile(
      join(fixture.directory, "orders/payment/zh-CN.mjs"),
      "export default { declined: 'script dictionary' };",
    );
    const app = await createTestApp({ ...options, rootDir: fixture.rootDir });
    try {
      expect(thrown(app.app)).toBe("script dictionary");
    } finally {
      await app.close();
    }
  });
});

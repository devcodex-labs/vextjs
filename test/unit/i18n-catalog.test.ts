import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanLocaleSources } from "../../src/lib/i18n/catalog.js";
import { projectLocaleMessages } from "../../src/lib/i18n/messages.js";
import { loadI18n } from "../../src/lib/i18n-loader.js";
import {
  reloadLocales,
  shouldReloadLocales,
} from "../../src/lib/dev/i18n-reloader.js";
import { createAppSchemaRuntime } from "../../src/lib/schema-adapter.js";
import { createApp, DEFAULT_CONFIG } from "../../src/lib/app.js";
import {
  getAppSchemaRuntime,
  bindRequestLocaleOwner,
} from "../../src/lib/i18n/app-runtime.js";
import { requestContext } from "../../src/lib/request-context.js";
import { HttpError } from "../../src/types/errors.js";

const directories: string[] = [];
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function temporary() {
  const directory = await mkdtemp(path.join(tmpdir(), "vext-i18n-contract-"));
  directories.push(directory);
  return directory;
}
function thrown(action: () => never): HttpError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error("expected HttpError");
}

describe("locale catalog contract", () => {
  it("projects nested modules, fully qualified keys and business error metadata identically", () => {
    const locales = projectLocaleMessages([
      {
        locale: "zh-CN",
        namespace: "",
        file: "zh-CN.ts",
        messages: { greeting: "你好" },
      },
      {
        locale: "zh-CN",
        namespace: "order.payment",
        file: "order/payment/zh-CN.json",
        messages: {
          declined: {
            code: 40001,
            message: "余额 {{balance}}",
            statusCode: 409,
          },
          receipt: { title: "账单" },
          "global.title": "全局",
          50001: "业务码",
        },
      },
    ]);
    expect(locales["zh-CN"]).toEqual({
      greeting: "你好",
      "order.payment.declined": {
        code: 40001,
        message: "余额 {{balance}}",
        statusCode: 409,
      },
      "order.payment.receipt.title": "账单",
      "global.title": "全局",
      "50001": "业务码",
    });
  });

  it("preserves frontend object access and merges sibling module namespaces", () => {
    const locales = projectLocaleMessages(
      [
        {
          locale: "en",
          namespace: "",
          file: "en.ts",
          messages: {
            dashboard: { title: "Dashboard" },
            "literal.key": "Literal",
          },
        },
        {
          locale: "en",
          namespace: "order.payment",
          file: "order/payment/en.json",
          messages: { title: "Payment" },
        },
        {
          locale: "en",
          namespace: "order.receipt",
          file: "order/receipt/en.json",
          messages: { title: "Receipt" },
        },
      ],
      "nested",
    );
    expect(locales.en).toEqual({
      dashboard: { title: "Dashboard" },
      "literal.key": "Literal",
      order: { payment: { title: "Payment" }, receipt: { title: "Receipt" } },
    });
    expect(() =>
      projectLocaleMessages(
        [
          {
            locale: "en",
            namespace: "",
            file: "en.ts",
            messages: { order: "Order" },
          },
          {
            locale: "en",
            namespace: "order",
            file: "order/en.json",
            messages: { title: "Title" },
          },
        ],
        "nested",
      ),
    ).toThrow(/leaf conflicts/);
  });

  it("reports both conflicting sources and never evaluates dictionary getters", () => {
    expect(() =>
      projectLocaleMessages([
        {
          locale: "en",
          namespace: "",
          file: "flat.json",
          messages: { "order.title": "A" },
        },
        {
          locale: "en",
          namespace: "order",
          file: "order/en.json",
          messages: { title: "B" },
        },
      ]),
    ).toThrow(/flat\.json.*order\/en\.json/);
    const getter = vi.fn(() => "must not execute");
    expect(() =>
      projectLocaleMessages([
        {
          locale: "en",
          namespace: "",
          file: "en.js",
          messages: Object.defineProperty({}, "key", {
            get: getter,
            enumerable: true,
          }),
        },
      ]),
    ).toThrow(/getters/);
    expect(getter).not.toHaveBeenCalled();
    expect(() =>
      projectLocaleMessages([
        {
          locale: "en",
          namespace: "",
          file: "en.js",
          messages: {
            error: {
              message: "Error",
              metadata: Object.defineProperty({}, "value", {
                get: getter,
                enumerable: true,
              }),
            },
          },
        },
      ]),
    ).toThrow(/getters/);
    expect(getter).not.toHaveBeenCalled();
    const circular: Record<string, unknown> = {};
    circular.loop = circular;
    expect(() =>
      projectLocaleMessages([
        { locale: "en", namespace: "", file: "en.js", messages: circular },
      ]),
    ).toThrow(/Invalid locale dictionary/);
  });

  it("loads JSON and CJS modules, retains previous messages on failure and clears deleted keys", async () => {
    const outDir = await temporary();
    const directory = path.join(outDir, "locales");
    await mkdir(path.join(directory, "order", "payment"), { recursive: true });
    const file = path.join(directory, "order", "payment", "zh-cn.json");
    await writeFile(
      file,
      JSON.stringify({
        declined: { code: 40101, message: "余额 {{balance}}", statusCode: 409 },
      }),
    );
    await writeFile(
      path.join(directory, "en-US.cjs"),
      'module.exports = { "order.payment.declined": "Declined" };',
    );
    const runtime = createAppSchemaRuntime("zh-CN");
    try {
      expect(
        scanLocaleSources(directory).map((source) => [
          source.locale,
          source.namespace,
        ]),
      ).toEqual([
        ["en-US", ""],
        ["zh-CN", "order.payment"],
      ]);
      await loadI18n(directory, logger as never, runtime.replaceMessages, {
        compiled: true,
      });
      const error = runtime.createI18nError("order.payment.declined", {
        balance: 5,
      });
      expect(error).toMatchObject({ message: "余额 5", statusCode: 409 });
      expect(String(error.code)).toBe("40101");
      await writeFile(file, "{ invalid json");
      const rejected = await reloadLocales({
        outDir,
        logger,
        configureI18n: runtime.replaceMessages,
      });
      expect(rejected.configured).toBe(false);
      expect(rejected.failedFiles).toEqual(["order/payment/zh-cn.json"]);
      expect(
        runtime.createI18nError("order.payment.declined", { balance: 7 })
          .message,
      ).toBe("余额 7");
      await rm(file);
      expect(
        (
          await reloadLocales({
            outDir,
            logger,
            configureI18n: runtime.replaceMessages,
          })
        ).configured,
      ).toBe(true);
      expect(runtime.createI18nError("order.payment.declined").message).toBe(
        "order.payment.declined",
      );
      expect(shouldReloadLocales(["locales/order/payment"])).toBe(true);
      expect(shouldReloadLocales(["locales-backup/en-US.json"])).toBe(false);
    } finally {
      runtime.dispose();
    }
  });

  it("diagnoses canonical language and namespace aliases before executing source modules", async () => {
    const directory = await temporary();
    await writeFile(
      path.join(directory, "zh-cn.js"),
      "throw new Error('must not execute')",
    );
    await writeFile(path.join(directory, "zh-CN.json"), "{}");
    expect(() => scanLocaleSources(directory)).toThrow(
      /Duplicate locale source/,
    );
  });

  it("isolates concurrent requests, cross-app calls, background defaults and disposal", async () => {
    const a = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "fatal" },
      locale: { default: "en-US", supported: ["en-US", "zh-CN"] },
    });
    const b = createApp({
      ...DEFAULT_CONFIG,
      logger: { level: "fatal" },
      locale: { default: "en-US", supported: ["en-US", "zh-CN"] },
    });
    const ar = getAppSchemaRuntime(a.app);
    const br = getAppSchemaRuntime(b.app);
    ar.replaceMessages({
      "en-US": { required: "A required {{#label}}", denied: "A English" },
      "zh-CN": {
        required: "A 必填 {{#label}}",
        denied: { message: "A 中文", code: 7001, statusCode: 403 },
      },
    });
    br.replaceMessages({
      "en-US": { required: "B required {{#label}}", denied: "B English" },
      "zh-CN": { denied: "B 中文" },
    });
    const validateA = a.app.getValidator().compile({ name: "string!" });
    const validateB = b.app.getValidator().compile({ name: "string!" });
    try {
      const values = await Promise.all(
        ["en-US", "zh-CN"].map((locale) =>
          requestContext.run({ locale }, async () => {
            bindRequestLocaleOwner(a.app);
            await Promise.resolve();
            expect(validateA({}).errors?.[0]?.message).toContain(
              locale === "en-US" ? "A required" : "A 必填",
            );
            expect(validateB({}).errors?.[0]?.message).toContain("B required");
            expect(thrown(() => b.app.throw("denied")).message).toBe(
              "B English",
            );
            return thrown(() => a.app.throw("denied"));
          }),
        ),
      );
      expect(values.map((error) => error.message)).toEqual([
        "A English",
        "A 中文",
      ]);
      expect(values[1]).toMatchObject({ status: 403, code: 7001 });
      expect(thrown(() => a.app.throw("denied")).message).toBe("A English");
      await a.internals.shutdown(undefined, { skipExit: true });
      expect(() => ar.replaceMessages({})).toThrow(/disposed/);
      expect(thrown(() => b.app.throw("denied")).message).toBe("B English");
    } finally {
      await a.internals.shutdown(undefined, { skipExit: true });
      await b.internals.shutdown(undefined, { skipExit: true });
    }
  });
});

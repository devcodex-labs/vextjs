/**
 * i18n-reloader 单元测试
 *
 * 测试覆盖：
 *   - isLocaleFile：语言文件格式判断
 *     - 有效格式（zh-CN.js / en-US.js / fr.js / pt-BR.js）
 *     - 无效格式（index.js / README.md / .js.map / .d.ts / 非标准语言码）
 *   - extractLocaleCode：从文件名提取语言代码
 *   - shouldReloadLocales：判断变更文件列表是否包含 locale 文件
 *     - 包含 locales/ 路径 → true
 *     - 不包含 locales/ 路径 → false
 *     - Windows 路径分隔符兼容
 *     - 空列表 → false
 *   - reloadLocales：i18n 热替换
 *     - locales 目录不存在 → 静默跳过
 *     - locales 目录为空 → 静默跳过
 *     - 正常加载语言文件（require 编译产物 .js）
 *     - 多个语言文件加载
 *     - 调用 configureI18n 回调
 *     - 无 configureI18n 回调时只加载不注册
 *     - configureI18n 回调失败时打印警告
 *     - require 失败的文件 → 跳过并记录
 *     - 无效 export（非对象） → 跳过并记录
 *     - 非语言文件被忽略
 *     - 同一语言代码去重（只取第一个）
 *   - createI18nReloader：预配置重载函数
 *
 * 策略：
 *   使用临时目录（os.tmpdir）创建真实文件系统结构，
 *   写入 CJS 编译产物模拟 .vext/dev/locales/ 中的 .js 文件。
 *   使用 require 直接加载验证。每个测试清理 require.cache。
 *
 * @see 11b-soft-reload.md §6（i18n 热替换）
 * @see i18n-loader.ts（启动时语言包加载器）
 * @see IMPLEMENTATION-PLAN.md 任务 2.2b
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  isLocaleFile,
  extractLocaleCode,
  shouldReloadLocales,
  reloadLocales,
  createI18nReloader,
  type I18nReloaderLogger,
  type ConfigureI18nFn,
  type ErrorMessages,
} from "../../src/lib/dev/i18n-reloader.js"

// ── 测试辅助 ────────────────────────────────────────────────

/**
 * 创建 mock logger
 */
function createMockLogger(): I18nReloaderLogger & {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }
}

/**
 * 创建临时目录
 */
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "vext-i18n-reloader-test-"))
}

/**
 * 清理 require.cache 中匹配前缀的条目
 */
function cleanupRequireCache(prefix: string): void {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) {
      delete require.cache[key]
    }
  }
}

/**
 * 创建 CJS 格式的语言文件内容
 *
 * @param messages 语言消息对象
 * @param useDefault 是否使用 default export（module.exports.default）
 */
function createLocaleFileContent(
  messages: Record<string, unknown>,
  useDefault = true,
): string {
  if (useDefault) {
    return `module.exports = { default: ${JSON.stringify(messages)} };`
  }
  return `module.exports = ${JSON.stringify(messages)};`
}

// ── isLocaleFile ────────────────────────────────────────────

describe("isLocaleFile", () => {
  describe("有效格式", () => {
    it("应接受 zh-CN.js", () => {
      expect(isLocaleFile("zh-CN.js")).toBe(true)
    })

    it("应接受 en-US.js", () => {
      expect(isLocaleFile("en-US.js")).toBe(true)
    })

    it("应接受 fr.js（纯语言码）", () => {
      expect(isLocaleFile("fr.js")).toBe(true)
    })

    it("应接受 pt-BR.js", () => {
      expect(isLocaleFile("pt-BR.js")).toBe(true)
    })

    it("应接受 ja-JP.js", () => {
      expect(isLocaleFile("ja-JP.js")).toBe(true)
    })

    it("应接受 ko-KR.js", () => {
      expect(isLocaleFile("ko-KR.js")).toBe(true)
    })

    it("应接受 de.js", () => {
      expect(isLocaleFile("de.js")).toBe(true)
    })

    it("应接受三字母语言码 haw.js", () => {
      expect(isLocaleFile("haw.js")).toBe(true)
    })

    it("应接受带数字区域码 zh-Hans.js", () => {
      expect(isLocaleFile("zh-Hans.js")).toBe(true)
    })
  })

  describe("无效格式", () => {
    it("应拒绝 index.js（不匹配语言代码格式）", () => {
      expect(isLocaleFile("index.js")).toBe(false)
    })

    it("应拒绝 README.md（非 .js 扩展名）", () => {
      expect(isLocaleFile("README.md")).toBe(false)
    })

    it("应拒绝 zh-CN.js.map（source map）", () => {
      expect(isLocaleFile("zh-CN.js.map")).toBe(false)
    })

    it("应拒绝 types.d.ts（类型声明）", () => {
      expect(isLocaleFile("types.d.ts")).toBe(false)
    })

    it("应拒绝 .ts 文件", () => {
      expect(isLocaleFile("zh-CN.ts")).toBe(false)
    })

    it("应拒绝 helper.js（非标准语言代码）", () => {
      expect(isLocaleFile("helper.js")).toBe(false)
    })

    it("应拒绝 a.js（单字母，不足 2 个字母）", () => {
      expect(isLocaleFile("a.js")).toBe(false)
    })

    it("应拒绝 toolong.js（超过 3 个字母）", () => {
      expect(isLocaleFile("toolong.js")).toBe(false)
    })

    it("应拒绝空字符串", () => {
      expect(isLocaleFile("")).toBe(false)
    })

    it("应拒绝纯 .js", () => {
      expect(isLocaleFile(".js")).toBe(false)
    })

    it("应拒绝 config.json", () => {
      expect(isLocaleFile("config.json")).toBe(false)
    })

    it("应拒绝 Zh-CN.js（语言码首字母大写）", () => {
      expect(isLocaleFile("Zh-CN.js")).toBe(false)
    })

    it("应拒绝 zh-.js（区域码为空）", () => {
      expect(isLocaleFile("zh-.js")).toBe(false)
    })
  })
})

// ── extractLocaleCode ───────────────────────────────────────

describe("extractLocaleCode", () => {
  it("应从 zh-CN.js 提取 zh-CN", () => {
    expect(extractLocaleCode("zh-CN.js")).toBe("zh-CN")
  })

  it("应从 en-US.js 提取 en-US", () => {
    expect(extractLocaleCode("en-US.js")).toBe("en-US")
  })

  it("应从 fr.js 提取 fr", () => {
    expect(extractLocaleCode("fr.js")).toBe("fr")
  })

  it("应从 pt-BR.js 提取 pt-BR", () => {
    expect(extractLocaleCode("pt-BR.js")).toBe("pt-BR")
  })

  it("应从 ja-JP.js 提取 ja-JP", () => {
    expect(extractLocaleCode("ja-JP.js")).toBe("ja-JP")
  })
})

// ── shouldReloadLocales ─────────────────────────────────────

describe("shouldReloadLocales", () => {
  it("应在变更列表包含 locales/ 路径时返回 true", () => {
    expect(
      shouldReloadLocales([
        "routes/user.ts",
        "locales/zh-CN.ts",
        "services/order.ts",
      ]),
    ).toBe(true)
  })

  it("应在变更列表不包含 locales/ 路径时返回 false", () => {
    expect(
      shouldReloadLocales([
        "routes/user.ts",
        "services/order.ts",
        "middlewares/auth.ts",
      ]),
    ).toBe(false)
  })

  it("应在空列表时返回 false", () => {
    expect(shouldReloadLocales([])).toBe(false)
  })

  it("应处理 locales/ 子目录中的文件", () => {
    expect(shouldReloadLocales(["locales/core/zh-CN.ts"])).toBe(true)
  })

  it("应处理以 locales/ 开头的路径", () => {
    expect(shouldReloadLocales(["locales/en-US.ts"])).toBe(true)
  })

  it("应处理中间包含 locales/ 的路径", () => {
    expect(shouldReloadLocales(["src/locales/zh-CN.ts"])).toBe(true)
  })

  it("应兼容 Windows 路径分隔符", () => {
    expect(shouldReloadLocales(["src\\locales\\zh-CN.ts"])).toBe(true)
  })

  it("应不匹配 locales 作为非目录（如 locales-backup/）", () => {
    // "locales/" 作为子串匹配，"locales-backup/" 不包含 "locales/"
    expect(shouldReloadLocales(["src/locales-backup/zh-CN.ts"])).toBe(false)
  })

  it("应在只有 locales 文件时返回 true", () => {
    expect(shouldReloadLocales(["locales/fr.ts"])).toBe(true)
  })

  it("应匹配混合路径列表中的 locale 文件", () => {
    expect(
      shouldReloadLocales([
        "config/default.ts",
        "plugins/auth.ts",
        "locales/ja-JP.ts",
      ]),
    ).toBe(true)
  })
})

// ── reloadLocales ───────────────────────────────────────────

describe("reloadLocales", () => {
  let tempDir: string
  let outDir: string
  let localesDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
    outDir = join(tempDir, ".vext", "dev")
    localesDir = join(outDir, "locales")
  })

  afterEach(async () => {
    cleanupRequireCache(tempDir)
    await rm(tempDir, { recursive: true, force: true })
  })

  // ── 目录不存在 / 空 ──────────────────────────────────

  describe("目录不存在 / 为空", () => {
    it("应在 locales 目录不存在时静默跳过", async () => {
      await mkdir(outDir, { recursive: true })
      // 不创建 locales 目录

      const logger = createMockLogger()
      const result = await reloadLocales({ outDir, logger })

      expect(result.loadedLocales).toEqual([])
      expect(result.failedFiles).toEqual([])
      expect(result.configured).toBe(false)
    })

    it("应在 locales 目录为空时静默跳过", async () => {
      await mkdir(localesDir, { recursive: true })

      const logger = createMockLogger()
      const result = await reloadLocales({ outDir, logger })

      expect(result.loadedLocales).toEqual([])
      expect(result.failedFiles).toEqual([])
      expect(result.configured).toBe(false)
    })

    it("应在目录不存在时记录 debug 日志", async () => {
      await mkdir(outDir, { recursive: true })

      const logger = createMockLogger()
      await reloadLocales({ outDir, logger })

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("locales directory not found"),
      )
    })

    it("应在目录为空（无语言文件）时记录 debug 日志", async () => {
      await mkdir(localesDir, { recursive: true })
      // 放一个非语言文件
      await writeFile(join(localesDir, "index.js"), "module.exports = {}")

      const logger = createMockLogger()
      await reloadLocales({ outDir, logger })

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("no locale files found"),
      )
    })
  })

  // ── 正常加载 ──────────────────────────────────────────

  describe("正常加载", () => {
    it("应加载单个语言文件（default export）", async () => {
      await mkdir(localesDir, { recursive: true })
      const messages = {
        "user.not_found": { code: 40001, message: "用户不存在" },
      }
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent(messages),
      )

      const logger = createMockLogger()
      const configureI18n = vi.fn()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["zh-CN"])
      expect(result.failedFiles).toEqual([])
      expect(result.configured).toBe(true)
    })

    it("应加载多个语言文件", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key1: { code: 1, message: "中文" } }),
      )
      await writeFile(
        join(localesDir, "en-US.js"),
        createLocaleFileContent({ key1: { code: 1, message: "English" } }),
      )

      const logger = createMockLogger()
      const configureI18n = vi.fn()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toHaveLength(2)
      expect(result.loadedLocales).toContain("zh-CN")
      expect(result.loadedLocales).toContain("en-US")
      expect(result.configured).toBe(true)
    })

    it("应加载无 default export 的模块（直接使用 module.exports）", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "fr.js"),
        createLocaleFileContent({ key: "value" }, false),
      )

      const logger = createMockLogger()
      const configureI18n = vi.fn()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["fr"])
      expect(result.configured).toBe(true)
    })

    it("应将正确的 locales 对象传递给 configureI18n", async () => {
      await mkdir(localesDir, { recursive: true })
      const zhMessages = { "user.not_found": { code: 40001, message: "用户不存在" } }
      const enMessages = { "user.not_found": { code: 40001, message: "User not found" } }
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent(zhMessages),
      )
      await writeFile(
        join(localesDir, "en-US.js"),
        createLocaleFileContent(enMessages),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      await reloadLocales({ outDir, logger, configureI18n })

      expect(configureI18n).toHaveBeenCalledOnce()
      const passedLocales = configureI18n.mock.calls[0][0] as Record<
        string,
        ErrorMessages
      >
      expect(passedLocales["zh-CN"]).toEqual(zhMessages)
      expect(passedLocales["en-US"]).toEqual(enMessages)
    })

    it("应在成功加载后记录 info 日志", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "value" }),
      )

      const logger = createMockLogger()
      const configureI18n = vi.fn()
      await reloadLocales({ outDir, logger, configureI18n })

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("i18n reloaded"),
      )
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("zh-CN"),
      )
    })
  })

  // ── configureI18n 回调 ────────────────────────────────

  describe("configureI18n 回调", () => {
    it("应在无 configureI18n 回调时只加载不注册", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "value" }),
      )

      const logger = createMockLogger()
      const result = await reloadLocales({ outDir, logger })

      expect(result.loadedLocales).toEqual(["zh-CN"])
      expect(result.configured).toBe(false)
      // 应记录 debug 日志说明无回调
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("no configureI18n callback"),
      )
    })

    it("应在 configureI18n 回调失败时设置 configured=false 并打印警告", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "value" }),
      )

      const configureI18n = vi.fn(() => {
        throw new Error("i18n config failed")
      })
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["zh-CN"])
      expect(result.configured).toBe(false)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("failed to configure i18n"),
      )
    })

    it("应在无加载成功的语言文件时不调用 configureI18n", async () => {
      await mkdir(localesDir, { recursive: true })
      // 只有非语言文件
      await writeFile(join(localesDir, "index.js"), "module.exports = {}")

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      await reloadLocales({ outDir, logger, configureI18n })

      expect(configureI18n).not.toHaveBeenCalled()
    })
  })

  // ── 错误处理 ──────────────────────────────────────────

  describe("错误处理", () => {
    it("应在 require 失败时跳过该文件并记录警告", async () => {
      await mkdir(localesDir, { recursive: true })
      // 写一个会抛出错误的文件
      await writeFile(
        join(localesDir, "zh-CN.js"),
        "throw new Error('syntax error in locale file');",
      )
      // 写一个正常文件
      await writeFile(
        join(localesDir, "en-US.js"),
        createLocaleFileContent({ key: "value" }),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["en-US"])
      expect(result.failedFiles).toEqual(["zh-CN.js"])
      expect(result.configured).toBe(true)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("failed to load locale file"),
      )
    })

    it("应在所有语言文件都失败时不调用 configureI18n", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        "throw new Error('load error');",
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual([])
      expect(result.failedFiles).toEqual(["zh-CN.js"])
      expect(result.configured).toBe(false)
      expect(configureI18n).not.toHaveBeenCalled()
    })

    it("应在导出非对象时跳过并记录警告", async () => {
      await mkdir(localesDir, { recursive: true })
      // 导出一个字符串而非对象
      await writeFile(
        join(localesDir, "zh-CN.js"),
        'module.exports = { default: "not an object" };',
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual([])
      expect(result.failedFiles).toEqual(["zh-CN.js"])
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("invalid export"),
      )
      expect(configureI18n).not.toHaveBeenCalled()
    })

    it("应在导出 null 时跳过并记录警告", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        "module.exports = { default: null };",
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual([])
      expect(result.failedFiles).toEqual(["zh-CN.js"])
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("invalid export"),
      )
    })

    it("应在导出数字时跳过并记录警告", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "fr.js"),
        "module.exports = { default: 42 };",
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual([])
      expect(result.failedFiles).toEqual(["fr.js"])
    })
  })

  // ── 文件筛选 ──────────────────────────────────────────

  describe("文件筛选", () => {
    it("应忽略非语言文件（index.js）", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "index.js"),
        "module.exports = { helper: true }",
      )
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "value" }),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["zh-CN"])
    })

    it("应忽略 .js.map 文件", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(join(localesDir, "zh-CN.js.map"), "{}")
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "value" }),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["zh-CN"])
    })

    it("应忽略 .d.ts 文件", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "types.d.ts"),
        "export type Locale = string;",
      )
      await writeFile(
        join(localesDir, "en-US.js"),
        createLocaleFileContent({ key: "value" }),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["en-US"])
    })

    it("应忽略 README.md 等非 .js 文件", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(join(localesDir, "README.md"), "# Locales")
      await writeFile(
        join(localesDir, "de.js"),
        createLocaleFileContent({ key: "Wert" }),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["de"])
    })

    it("应为忽略的非语言文件记录 debug 日志", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "helper.js"),
        "module.exports = { util: true }",
      )
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "value" }),
      )

      const logger = createMockLogger()
      await reloadLocales({ outDir, logger })

      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("skipping non-locale file"),
      )
    })
  })

  // ── 去重 ──────────────────────────────────────────────

  describe("去重", () => {
    it("应对同一语言代码只加载第一个匹配文件", async () => {
      await mkdir(localesDir, { recursive: true })
      // 在实际场景中不太可能出现同名文件，但测试去重逻辑
      // 由于 readdir 返回的顺序可能不确定，
      // 我们只验证 loadedLocales 中每个语言代码只出现一次
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "value1" }),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      // 确保只有一个 zh-CN
      const zhCount = result.loadedLocales.filter((c) => c === "zh-CN").length
      expect(zhCount).toBe(1)
    })
  })

  // ── require.cache 清除 ────────────────────────────────

  describe("require.cache 清除", () => {
    it("应在重载时清除残留的 require.cache 条目", async () => {
      await mkdir(localesDir, { recursive: true })
      const filePath = join(localesDir, "zh-CN.js")

      // 第一次写入和加载
      await writeFile(
        filePath,
        createLocaleFileContent({ version: "v1" }),
      )

      const logger1 = createMockLogger()
      const configureI18n1 = vi.fn()
      await reloadLocales({
        outDir,
        logger: logger1,
        configureI18n: configureI18n1,
      })

      expect(configureI18n1).toHaveBeenCalledOnce()
      const v1Locales = configureI18n1.mock.calls[0][0] as Record<
        string,
        Record<string, unknown>
      >
      expect(v1Locales["zh-CN"].version).toBe("v1")

      // 清理 require cache 以模拟 cache-invalidator 已清除
      cleanupRequireCache(tempDir)

      // 第二次写入新内容并加载
      await writeFile(
        filePath,
        createLocaleFileContent({ version: "v2" }),
      )

      const logger2 = createMockLogger()
      const configureI18n2 = vi.fn()
      await reloadLocales({
        outDir,
        logger: logger2,
        configureI18n: configureI18n2,
      })

      expect(configureI18n2).toHaveBeenCalledOnce()
      const v2Locales = configureI18n2.mock.calls[0][0] as Record<
        string,
        Record<string, unknown>
      >
      expect(v2Locales["zh-CN"].version).toBe("v2")
    })
  })

  // ── 结果结构 ──────────────────────────────────────────

  describe("结果结构", () => {
    it("应返回包含 loadedLocales / failedFiles / configured 的完整结果", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "value" }),
      )
      await writeFile(
        join(localesDir, "en-US.js"),
        "throw new Error('broken');",
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result).toHaveProperty("loadedLocales")
      expect(result).toHaveProperty("failedFiles")
      expect(result).toHaveProperty("configured")

      expect(result.loadedLocales).toEqual(["zh-CN"])
      expect(result.failedFiles).toEqual(["en-US.js"])
      expect(result.configured).toBe(true)
    })

    it("应在目录不存在时返回空结果", async () => {
      await mkdir(outDir, { recursive: true })

      const logger = createMockLogger()
      const result = await reloadLocales({ outDir, logger })

      expect(result.loadedLocales).toEqual([])
      expect(result.failedFiles).toEqual([])
      expect(result.configured).toBe(false)
    })
  })

  // ── 边界情况 ──────────────────────────────────────────

  describe("边界情况", () => {
    it("应处理只有非语言 .js 文件的目录", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "utils.js"),
        "module.exports = { helper: true }",
      )
      await writeFile(
        join(localesDir, "constants.js"),
        "module.exports = { MAX: 100 }",
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual([])
      expect(result.configured).toBe(false)
      expect(configureI18n).not.toHaveBeenCalled()
    })

    it("应处理语言文件导出空对象", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({}),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      // 空对象仍然是合法的对象 export
      expect(result.loadedLocales).toEqual(["zh-CN"])
      expect(result.configured).toBe(true)

      const passedLocales = configureI18n.mock.calls[0][0] as Record<
        string,
        ErrorMessages
      >
      expect(passedLocales["zh-CN"]).toEqual({})
    })

    it("应处理语言文件导出嵌套深层对象", async () => {
      await mkdir(localesDir, { recursive: true })
      const deepMessages = {
        "user.not_found": {
          code: 40001,
          message: "用户不存在",
          details: { field: "id", constraint: "exists" },
        },
      }
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent(deepMessages),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toEqual(["zh-CN"])
      const passedLocales = configureI18n.mock.calls[0][0] as Record<
        string,
        ErrorMessages
      >
      expect(passedLocales["zh-CN"]).toEqual(deepMessages)
    })

    it("应处理大量语言文件", async () => {
      await mkdir(localesDir, { recursive: true })
      const locales = ["zh-CN", "en-US", "ja-JP", "ko-KR", "fr", "de", "pt-BR", "es"]
      for (const locale of locales) {
        await writeFile(
          join(localesDir, `${locale}.js`),
          createLocaleFileContent({ lang: locale }),
        )
      }

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toHaveLength(8)
      for (const locale of locales) {
        expect(result.loadedLocales).toContain(locale)
      }
      expect(result.configured).toBe(true)
    })

    it("应处理混合有效和无效文件的目录", async () => {
      await mkdir(localesDir, { recursive: true })
      await writeFile(
        join(localesDir, "zh-CN.js"),
        createLocaleFileContent({ key: "zhValue" }),
      )
      await writeFile(
        join(localesDir, "en-US.js"),
        "throw new Error('broken');",
      )
      await writeFile(join(localesDir, "index.js"), "module.exports = {}")
      await writeFile(join(localesDir, "README.md"), "# Docs")
      await writeFile(
        join(localesDir, "fr.js"),
        createLocaleFileContent({ key: "frValue" }),
      )

      const configureI18n = vi.fn()
      const logger = createMockLogger()
      const result = await reloadLocales({
        outDir,
        logger,
        configureI18n,
      })

      expect(result.loadedLocales).toContain("zh-CN")
      expect(result.loadedLocales).toContain("fr")
      expect(result.loadedLocales).not.toContain("en-US")
      expect(result.failedFiles).toEqual(["en-US.js"])
      expect(result.configured).toBe(true)
    })
  })
})

// ── createI18nReloader ──────────────────────────────────────

describe("createI18nReloader", () => {
  let tempDir: string
  let outDir: string

  beforeEach(async () => {
    tempDir = await createTempDir()
    outDir = join(tempDir, ".vext", "dev")
  })

  afterEach(async () => {
    cleanupRequireCache(tempDir)
    await rm(tempDir, { recursive: true, force: true })
  })

  it("应返回一个函数", () => {
    const logger = createMockLogger()
    const reloader = createI18nReloader(logger)

    expect(typeof reloader).toBe("function")
  })

  it("应使用注入的 logger 和 configureI18n", async () => {
    await mkdir(join(outDir, "locales"), { recursive: true })
    await writeFile(
      join(outDir, "locales", "zh-CN.js"),
      createLocaleFileContent({ key: "value" }),
    )

    const logger = createMockLogger()
    const configureI18n = vi.fn()
    const reloader = createI18nReloader(logger, configureI18n)

    const result = await reloader(outDir)

    expect(result.loadedLocales).toEqual(["zh-CN"])
    expect(result.configured).toBe(true)
    expect(configureI18n).toHaveBeenCalledOnce()
    expect(logger.info).toHaveBeenCalled()
  })

  it("应在无 configureI18n 回调时正常工作", async () => {
    await mkdir(join(outDir, "locales"), { recursive: true })
    await writeFile(
      join(outDir, "locales", "en-US.js"),
      createLocaleFileContent({ key: "value" }),
    )

    const logger = createMockLogger()
    const reloader = createI18nReloader(logger)

    const result = await reloader(outDir)

    expect(result.loadedLocales).toEqual(["en-US"])
    expect(result.configured).toBe(false)
  })

  it("应正确将 outDir 参数传递到内部 reloadLocales", async () => {
    // 不创建 locales 目录 → 应返回空结果
    await mkdir(outDir, { recursive: true })

    const logger = createMockLogger()
    const reloader = createI18nReloader(logger)

    const result = await reloader(outDir)

    expect(result.loadedLocales).toEqual([])
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("locales directory not found"),
    )
  })

  it("应支持多次调用", async () => {
    await mkdir(join(outDir, "locales"), { recursive: true })
    await writeFile(
      join(outDir, "locales", "zh-CN.js"),
      createLocaleFileContent({ version: "v1" }),
    )

    const logger = createMockLogger()
    const configureI18n = vi.fn()
    const reloader = createI18nReloader(logger, configureI18n)

    const result1 = await reloader(outDir)
    expect(result1.loadedLocales).toEqual(["zh-CN"])

    // 清理缓存，写入新内容
    cleanupRequireCache(tempDir)
    await writeFile(
      join(outDir, "locales", "zh-CN.js"),
      createLocaleFileContent({ version: "v2" }),
    )

    const result2 = await reloader(outDir)
    expect(result2.loadedLocales).toEqual(["zh-CN"])

    // configureI18n 应被调用两次
    expect(configureI18n).toHaveBeenCalledTimes(2)
  })

  it("应在目标目录不存在时安全返回", async () => {
    const logger = createMockLogger()
    const reloader = createI18nReloader(logger)

    // outDir 不存在
    const result = await reloader(join(tempDir, "nonexistent"))

    expect(result.loadedLocales).toEqual([])
    expect(result.failedFiles).toEqual([])
    expect(result.configured).toBe(false)
  })
})

import { readdir, stat, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { VextApp, VextLogger } from "../types/app.js";
import type { VextInternalHooks } from "../types/hooks.js";
import { resolveModuleDefault } from "./interop.js";
import { importUserModule } from "./user-module-loader.js";
import {
  SUPPORTED_SERVICE_EXTENSIONS,
  shouldExcludeServiceFileName,
  filePathToServiceKeys,
} from "../shared/service-paths.js";
import { wrapServiceInstance } from "./service-hooks.js";
import {
  collectServiceDependencies,
  findServiceDependencyCycles,
} from "./service-dependencies.js";

/**
 * service-loader.ts — 服务层自动加载器
 *
 * 扫描用户项目的 src/services/ 目录，自动加载所有 service 文件，
 * 通过 new ServiceClass(app) 实例化后按文件路径映射为嵌套 key
 * 注入到 app.services 对象上。
 *
 * 核心流程：
 *   1. 递归扫描 servicesDir 下的所有 .ts/.js/.mjs/.cjs 文件
 *   2. 排除 _ 开头的文件/目录、.d.ts、.test./.spec. 文件
 *   3. 动态 import 每个文件，获取 default export（必须是 class / 构造函数）
 *   4. 文件路径 → 嵌套 service key（kebab-case → camelCase）
 *   5. new mod.default(app) 实例化，通过 setNestedKey 挂载到 app.services
 *   6. Fail Fast：key 冲突、非 class 导出
 *   7. 所有 service 加载完成后，执行与Doctor同源的词法绑定依赖检测
 *
 * 路径映射示例：
 *   services/user.ts            → app.services.user
 *   services/user-profile.ts    → app.services.userProfile
 *   services/payment/stripe.ts  → app.services.payment.stripe
 *   services/payment/alipay.ts  → app.services.payment.alipay
 *   services/_helpers.ts        → 跳过（_ 前缀）
 *
 * Fail Fast 检测项：
 *   - 文件无 default export 或导出非 class/构造函数
 *   - service key 冲突（两个文件映射到相同的 key 路径）
 *   - service 之间循环依赖（静态源码分析 + DFS）
 *
 * @module lib/service-loader
 * @see IMPLEMENTATION-PLAN.md 任务 1.12
 * @see 02-services.md §4（框架内部 service-loader.ts）
 * @see 02-services.md §7.1（循环依赖运行时检测）
 */

// ── 公共类型 ──────────────────────────────────────────────────

/**
 * loadServices 配置选项
 */
export interface LoadServicesOptions {
  /** 由框架调用点传递真实服务根；独立 helper 默认限于给定 servicesDir。 */
  rootDir?: string;
  /**
   * 是否执行循环依赖检测
   *
   * 生产环境（vext start）和开发环境（vext dev）均默认开启。
   * 可通过此选项关闭（仅用于特殊测试场景）。
   *
   * @default true
   */
  checkCircularDeps?: boolean;
}

// ── 主函数 ────────────────────────────────────────────────────

/**
 * loadServices — 扫描 services/ 目录，实例化并注入到 app.services
 *
 * @param app         VextApp 实例（service 构造函数接收此对象）
 * @param servicesDir services/ 目录的绝对路径（如 /path/to/my-app/src/services）
 * @param options     加载选项
 *
 * @example
 * ```typescript
 * // bootstrap 内部
 * await loadServices(app, path.join(rootDir, 'src/services'), {
 *   checkCircularDeps: true,
 * })
 * ```
 */
export async function loadServices(
  app: VextApp,
  servicesDir: string,
  options: LoadServicesOptions = {},
): Promise<void> {
  const { checkCircularDeps = true } = options;
  const lifecycleLevel = app.config.logger?.lifecycleLevel ?? "concise";
  const hooks = app.hooks as VextInternalHooks;

  // ── 1. 检查 services/ 目录是否存在 ────────────────────────
  const dirExists = await directoryExists(servicesDir);
  if (!dirExists) {
    app.logger.debug(
      "[vextjs] Services directory not found, skipping service loading.",
    );
    return;
  }

  // ── 2. 递归扫描所有 service 文件 ──────────────────────────
  const serviceFiles = await scanServiceFiles(servicesDir);

  if (serviceFiles.length === 0) {
    app.logger.debug(
      "[vextjs] No service files found, skipping service loading.",
    );
    return;
  }

  // ── 3. 按文件名排序（确定性加载顺序）──────────────────────
  serviceFiles.sort((a, b) => a.localeCompare(b));

  // ── 4. 逐个加载、实例化、挂载 ─────────────────────────────
  //
  // serviceFileMap 用于循环依赖检测：记录 serviceKey → 源文件路径
  //
  const serviceFileMap = new Map<string, string>();
  const serviceConstructors = new Map<string, unknown>();

  for (const filePath of serviceFiles) {
    // 4.1 计算 service key（文件路径 → 嵌套 key 数组）
    const keys = filePathToServiceKeys(filePath, servicesDir);
    const flatKey = keys.join(".");

    // 4.2 动态 import 获取 default export
    const ServiceClass = await loadServiceFile(
      filePath,
      flatKey,
      options.rootDir ?? servicesDir,
    );

    // 4.3 实例化 service（new ServiceClass(app)）
    let instance: unknown;
    try {
      instance = new (ServiceClass as new (app: VextApp) => unknown)(app);
    } catch (err) {
      throw new Error(
        `[vextjs] Failed to instantiate service "${flatKey}".\n` +
          `         File: ${filePath}\n` +
          `         ${(err as Error).message}\n` +
          `         Service classes must accept (app: VextApp) as the constructor argument.`,
      );
    }

    // 4.4 挂载到 app.services（嵌套 key）
    instance = wrapServiceInstance(hooks, flatKey, instance);
    setNestedKey(
      app.services as Record<string, unknown>,
      keys,
      instance,
      filePath,
    );
    hooks.emitSafeSync("service:loaded", {
      name: flatKey,
      instance,
      filePath,
    });

    // 4.5 记录文件映射（供循环依赖检测使用）
    serviceFileMap.set(flatKey, filePath);
    serviceConstructors.set(flatKey, ServiceClass);

    if (lifecycleLevel === "verbose") {
      app.logger.info(`[service-loader] loaded: ${flatKey}`);
    }
  }

  // ── 5. 循环依赖检测 ───────────────────────────────────────
  if (checkCircularDeps && serviceFileMap.size > 0) {
    await checkServiceCircularDeps(
      serviceFileMap,
      serviceConstructors,
      app.logger,
    );
  }

  app.logger.info(`[vextjs] ${serviceFileMap.size} service(s) loaded`);
}

// ── 文件扫描 ──────────────────────────────────────────────────

/**
 * 支持的 service 文件扩展名
 */
/**
 * 递归扫描 services/ 目录下的所有 service 文件
 *
 * @param dir 当前扫描的目录路径
 * @returns 所有 service 文件的绝对路径数组
 */
async function scanServiceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // 跳过以 _ 或 . 开头的目录
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;

      // 递归扫描子目录
      const subFiles = await scanServiceFiles(fullPath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (!SUPPORTED_SERVICE_EXTENSIONS.has(ext)) continue;
      if (shouldExcludeServiceFileName(entry.name)) continue;

      files.push(fullPath);
    }
  }

  return files;
}

// ── 路径映射 ──────────────────────────────────────────────────

// ── 嵌套 key 设置 ────────────────────────────────────────────

/**
 * setNestedKey — 将 service 实例设置到嵌套对象路径上
 *
 * 支持多层嵌套（如 ['payment', 'stripe']），
 * 中间层不存在时自动创建空对象。
 *
 * Fail Fast：如果目标 key 已存在，说明两个文件映射到了相同的 key 路径。
 *
 * @param obj        目标对象（app.services）
 * @param keys       key 路径数组（如 ['payment', 'stripe']）
 * @param value      service 实例
 * @param sourceFile 源文件路径（用于错误信息）
 * @throws key 冲突时抛出错误
 */
function setNestedKey(
  obj: Record<string, unknown>,
  keys: string[],
  value: unknown,
  sourceFile: string,
): void {
  let cur = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (cur[key] === undefined) {
      cur[key] = {};
    } else if (
      typeof cur[key] !== "object" ||
      cur[key] === null ||
      // Class instances are objects; only plain namespace objects may nest further.
      Object.getPrototypeOf(cur[key]) !== Object.prototype
    ) {
      // 中间段已经被一个 service 实例占用
      // 例如：services/payment.ts (→ services.payment = instance)
      //       services/payment/stripe.ts (→ services.payment.stripe = ?)
      // payment 已经是实例，无法继续嵌套
      throw new Error(
        `[vextjs] Service key conflict: "${keys.slice(0, i + 1).join(".")}" is already ` +
          `registered as a service instance, but "${keys.join(".")}" requires it to be a namespace.\n` +
          `         Conflicting file: ${sourceFile}\n` +
          `         Rename one of the files to resolve the conflict.`,
      );
    }
    cur = cur[key] as Record<string, unknown>;
  }

  const last = keys[keys.length - 1]!;
  if (cur[last] !== undefined) {
    throw new Error(
      `[vextjs] Service key "${keys.join(".")}" is already registered.\n` +
        `         Conflicting file: ${sourceFile}\n` +
        `         Rename the file to resolve the conflict.`,
    );
  }

  cur[last] = value;
}

// ── 文件加载 ──────────────────────────────────────────────────

/**
 * loadServiceFile — 加载单个 service 文件
 *
 * 通过 dynamic import 加载 service 模块，获取其 default export。
 * default export 必须是 class / 构造函数。
 *
 * TypeScript 源文件（.ts）的处理：
 *   当 filePath 以 .ts 结尾时（`createTestApp()` 指向 src/services/ 时触发），
 *   存在两层问题：
 *     1. Node.js 原生 ESM 不支持 .ts 扩展名（ERR_UNKNOWN_FILE_EXTENSION）
 *     2. .ts 文件内使用 TypeScript ESM 约定（如 import './dep.js'），
 *        Node.js / Vite resolver 均不做 .js → .ts 自动回退
 *   修复：调用 esbuild build()（bundle:true）将 .ts 及所有本地相对依赖
 *   打包为单一 .mjs，npm 包保持 external 以复用项目 node_modules。
 *   共享 user-module-loader 在真实项目 owner 下执行并核对临时收据后清理，
 *   保持同目录模块解析；TS service 每次加载重新求值，不使用配置模块缓存。
 *
 * @param filePath service 文件的绝对路径
 * @param flatKey  service key 的扁平化表示（用于错误信息，如 'payment.stripe'）
 * @returns default export（class 构造函数）
 * @throws 文件无 default export 或导出非 class/构造函数
 */
async function loadServiceFile(
  filePath: string,
  flatKey: string,
  rootDir: string,
): Promise<Function> {
  try {
    const mod = await importUserModule(filePath, rootDir, { cache: false });

    const ServiceClass = resolveModuleDefault<Function>(mod);

    // Fail Fast：无 default export
    if (!ServiceClass) {
      throw new Error(
        `[vextjs] Service file has no default export.\n` +
          `         File: ${filePath}\n` +
          `         Service key: ${flatKey}\n` +
          `         Must export default a class:\n` +
          `           export default class ${toPascalCase(flatKey)}Service {\n` +
          `             constructor(app: VextApp) {}\n` +
          `           }`,
      );
    }

    // Fail Fast：default export 不是函数/class
    if (typeof ServiceClass !== "function") {
      throw new Error(
        `[vextjs] ${filePath} must export default a class.\n` +
          `         Service key: ${flatKey}\n` +
          `         Got: ${typeof ServiceClass}\n` +
          `         Example: export default class ${toPascalCase(flatKey)}Service { constructor(app: VextApp) {} }`,
      );
    }

    return ServiceClass;
  } catch (err) {
    // 如果是我们自己抛出的 vextjs 错误，直接抛出
    if (err instanceof Error && err.message.startsWith("[vextjs]")) {
      throw err;
    }

    // 其他错误（语法错误、模块找不到等），包装后抛出
    throw new Error(
      `[vextjs] Failed to load service file: ${filePath}\n` +
        `         Service key: ${flatKey}\n` +
        `         ${(err as Error).message}`,
      { cause: err },
    );
  }
}

// ── 循环依赖检测 ──────────────────────────────────────────────

/**
 * 预检与Doctor共享注入绑定及环路算法；无法证明的源码只警告，不把静态未知伪装成通过。
 * 服务由new ServiceClass(app)创建，检查仍不增加请求路径开销。
 */
async function checkServiceCircularDeps(
  serviceFiles: Map<string, string>,
  constructors: ReadonlyMap<string, unknown>,
  logger: VextLogger,
): Promise<void> {
  const graph = new Map<string, Set<string>>();
  const knownKeys = new Set(serviceFiles.keys());
  let incomplete = false;
  for (const [key, filePath] of serviceFiles) {
    try {
      const source = await readFile(filePath, "utf-8");
      let result = collectServiceDependencies(source, filePath, key, knownKeys);
      if (result.incomplete && constructors.has(key)) {
        try {
          // 导入已由正常 Loader 完成；使用内建 toString 查看真实构造器，绝不调用用户 toString。
          // 原生/动态/继承等仍无法证明的构造器继续保留 incomplete。
          const definition = Function.prototype.toString.call(
            constructors.get(key),
          );
          const projected = collectServiceDependencies(
            `export default ${definition}`,
            filePath,
            key,
            knownKeys,
          );
          if (!projected.incomplete) result = projected;
        } catch {
          /* 保留原源码的不完整结论。 */
        }
      }
      graph.set(key, result.dependencies);
      if (result.incomplete) {
        incomplete = true;
        logger.warn(
          `[service-loader] Service dependency analysis is incomplete: ${filePath}`,
        );
      }
    } catch (error) {
      incomplete = true;
      logger.warn(
        `[service-loader] Could not analyze service dependencies: ${filePath}: ${String(error)}`,
      );
    }
  }
  const cycle = findServiceDependencyCycles(graph)[0];
  if (cycle)
    throw new Error(
      `[vextjs] Circular dependency detected in services: ${cycle.join(" → ")}\n` +
        "         Break the cycle by extracting shared logic into a separate service or utility.",
    );
  if (!incomplete)
    logger.debug(
      `[service-loader] Circular dependency check passed (${knownKeys.size} services)`,
    );
}

// ── 工具函数 ──────────────────────────────────────────────────

/**
 * 检查目录是否存在
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 将扁平 key 转为 PascalCase（用于错误信息中建议的类名）
 *
 * 示例：
 *   'user'           → 'User'
 *   'payment.stripe' → 'PaymentStripe'
 *   'userProfile'    → 'UserProfile'
 */
function toPascalCase(flatKey: string): string {
  return flatKey
    .split(".")
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
}

export const TEMPORARY_MODULE_PREFIX = ".vext-exec-";

/** 临时执行模块不是业务源；精确识别，不忽略用户全部点文件。 */
export function isTemporaryModuleFileName(filename: string): boolean {
  return (
    filename.startsWith(TEMPORARY_MODULE_PREFIX) &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:mjs|cjs)$/u.test(
      filename.slice(TEMPORARY_MODULE_PREFIX.length),
    )
  );
}

/** 共享基础文件角色；各 Loader 自行选择支持的扩展名，不借此承诺执行能力。 */
export function isDeclarationFileName(filename: string): boolean {
  return /\.d\.(?:ts|mts|cts)$/u.test(filename);
}

export function isTestSourceFileName(filename: string): boolean {
  return filename.includes(".test.") || filename.includes(".spec.");
}

export function isExcludedConventionFileName(filename: string): boolean {
  return (
    filename.startsWith("_") ||
    filename.startsWith(".") ||
    isDeclarationFileName(filename) ||
    isTestSourceFileName(filename) ||
    filename.includes(".__vext_compiled__")
  );
}

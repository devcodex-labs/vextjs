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

/** Shared by runtime discovery and static documentation/assistant inspection. */
export function inferJobName(sourcePath: string, exportName: string): string {
  const withoutExt = sourcePath.replace(/\.(?:ts|js|mjs|cjs|mts|cts)$/iu, "");
  const normalized = withoutExt.endsWith("/index")
    ? withoutExt.slice(0, -"/index".length)
    : withoutExt;
  const fileName = normalized.replaceAll("/", ".").replace(/\.+/gu, ".");
  return exportName === "default" ? fileName : `${fileName}.${exportName}`;
}

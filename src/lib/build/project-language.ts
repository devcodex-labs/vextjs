import fg from "fast-glob";
import path from "node:path";
import { SOURCE_IGNORE } from "./shared-esbuild-config.js";

/** tsconfig 也可服务于 JS/checkJs；是否需要后端编译由实际运行源码决定。 */
export function detectProjectLanguage(rootDir: string): "ts" | "js" {
  const files = fg.sync("**/*.{ts,mts,cts}", {
    cwd: path.join(rootDir, "src"),
    onlyFiles: true,
    ignore: [...SOURCE_IGNORE, "preload/**"],
  });
  return files.length > 0 ? "ts" : "js";
}

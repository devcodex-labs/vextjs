import fg from "fast-glob";
import path from "node:path";
import { backendSourceIgnore } from "./shared-esbuild-config.js";
import type { FrontendLayoutInput } from "../project/layout.js";

/** tsconfig 也可服务于 JS/checkJs；是否需要后端编译由实际运行源码决定。 */
export function detectProjectLanguage(
  rootDir: string,
  frontend?: FrontendLayoutInput,
): "ts" | "js" {
  const srcDir = path.join(rootDir, "src");
  const files = fg.sync("**/*.{ts,mts,cts}", {
    cwd: srcDir,
    onlyFiles: true,
    ignore: [...backendSourceIgnore(rootDir, srcDir, frontend), "preload/**"],
  });
  return files.length > 0 ? "ts" : "js";
}

import path from "node:path";
import { pathToFileURL } from "node:url";

/** 保留原生 meta 对象；别名和解构也应看到逻辑模块位置，而非随机暂存路径。 */
export function logicalModuleMetaBanner(filename: string): string {
  return [
    `import.meta.url = ${JSON.stringify(pathToFileURL(filename).href)};`,
    `import.meta.filename = ${JSON.stringify(filename)};`,
    `import.meta.dirname = ${JSON.stringify(path.dirname(filename))};`,
  ].join("\n");
}

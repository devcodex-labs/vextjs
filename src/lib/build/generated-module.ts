import { createRequire } from "node:module";
import path from "node:path";
import { compileFunction, constants } from "node:vm";

/** 构建阶段执行已经 bundle 的生成模块；不是静态分析器，也不是权限隔离。 */
export function evaluateGeneratedModule<T>(
  contents: Uint8Array | string,
  logicalPath: string,
): T {
  const filename = path.resolve(logicalPath);
  const require = createRequire(filename);
  const module = { exports: {} as unknown };
  const compiled = compileFunction(
    Buffer.from(contents).toString("utf8"),
    ["exports", "require", "module", "__filename", "__dirname"],
    {
      filename,
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    },
  );
  compiled.call(
    module.exports,
    module.exports,
    require,
    module,
    filename,
    path.dirname(filename),
  );
  return module.exports as T;
}

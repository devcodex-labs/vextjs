import {
  resolveConfigProfile,
  type RuntimeMode,
} from "../../lib/config-profile.js";
import { _patchMiddlewares } from "../../lib/config-loader.js";
import type { SourceView } from "../source-view/types.js";
import { PROJECT_SOURCE_ROOT_ID as ASSISTANT_SOURCE_ROOT } from "./source-input.js";
import {
  absentStaticValue,
  mergeStaticValues,
  readStaticDefault,
  staticFact,
  staticMember,
  type StaticFact,
  type StaticValue,
} from "./static-values.js";

export interface StaticConfigProjection {
  profile: string;
  mode: RuntimeMode;
  sourceFiles: string[];
  providerState: "absent" | "unknown";
  warnings: string[];
  field(path: string): StaticFact;
}

/** 与运行时扩展名及 default→profile→local 顺序一致；不执行 bootstrap provider。 */
export function projectStaticConfig(
  view: SourceView,
  options: { profile?: string; mode?: RuntimeMode } = {},
): StaticConfigProjection {
  const profile =
    options.profile ?? resolveConfigProfile({ command: "dev" }).profile;
  const mode = options.mode ?? "development";
  const extensions = ["ts", "js", "mjs", "cjs"];
  const sourceFiles: string[] = [];
  const warnings: string[] = [];
  const invalidLayers: Array<{ file: string; reason: string }> = [];
  let value: StaticValue = absentStaticValue();
  const selected = (name: string) =>
    extensions
      .map((ext) => `src/config/${name}.${ext}`)
      .find((file) => view.record(ASSISTANT_SOURCE_ROOT, file) !== undefined);
  for (const name of new Set([
    "default",
    profile,
    ...(mode === "production" ? [] : ["local"]),
  ])) {
    const file = selected(name);
    if (!file) {
      if (name === "default")
        warnings.push("Required default config source is absent.");
      continue;
    }
    sourceFiles.push(file);
    const layer = readStaticDefault(
      file,
      view.read(ASSISTANT_SOURCE_ROOT, file)!,
    );
    if (layer.kind === "invalid")
      invalidLayers.push({ file, reason: layer.reason });
    const baseMiddlewareValue = staticMember(value, "middlewares");
    const baseMiddleware = staticFact(baseMiddlewareValue, sourceFiles);
    const layerMiddleware = staticFact(staticMember(layer, "middlewares"), [
      file,
    ]);
    value = mergeStaticValues(value, layer);
    if (value.kind === "object" && layerMiddleware.state !== "absent") {
      if (
        layerMiddleware.state === "known" &&
        layerMiddleware.value === undefined
      ) {
        // 运行时忽略顶层 middlewares: undefined，保留上一层声明。
        if (baseMiddlewareValue)
          value.fields.set("middlewares", baseMiddlewareValue);
        else value.fields.delete("middlewares");
      } else if (
        (baseMiddleware.state === "known" ||
          baseMiddleware.state === "absent") &&
        layerMiddleware.state === "known" &&
        Array.isArray(layerMiddleware.value)
      ) {
        try {
          const patched = _patchMiddlewares(
            (baseMiddleware.value ?? []) as Parameters<
              typeof _patchMiddlewares
            >[0],
            layerMiddleware.value,
          );
          value.fields.set("middlewares", fromStaticData(patched));
        } catch (error) {
          value.fields.set("middlewares", {
            kind: "invalid",
            reason: String(error),
          });
        }
      } else if (
        baseMiddleware.state === "unknown" &&
        layerMiddleware.state === "known" &&
        Array.isArray(layerMiddleware.value)
      ) {
        value.fields.set("middlewares", {
          kind: "unknown",
          reason:
            "Middleware patch retains entries from an unknown earlier layer.",
        });
      }
    }
  }
  const providerState = selected("bootstrap") ? "unknown" : "absent";
  if (providerState === "unknown")
    warnings.push(
      "A bootstrap provider may override configuration at runtime; its result is not executed or assumed by MCP.",
    );
  return {
    profile,
    mode,
    sourceFiles,
    providerState,
    warnings,
    field(fieldPath) {
      // 所有层都必须先成功加载；后续字段覆盖不能使语法错误恢复为有效配置。
      if (invalidLayers.length)
        return {
          state: "invalid",
          sourceRefs: invalidLayers.map((item) => item.file),
          reason: invalidLayers
            .map((item) => `${item.file}: ${item.reason}`)
            .join("; "),
        };
      let current: StaticValue | undefined = value;
      for (const key of fieldPath.split(".")) {
        if (current === undefined) break;
        current = staticMember(current, key);
      }
      const fact = staticFact(current, sourceFiles);
      if (providerState === "unknown" && fact.state !== "invalid")
        return {
          state: "unknown",
          sourceRefs: [...sourceFiles, selected("bootstrap")!],
          reason: "Bootstrap provider may override this field.",
        };
      return fact;
    },
  };
}

function fromStaticData(value: unknown): StaticValue {
  if (Array.isArray(value))
    return { kind: "array", items: value.map(fromStaticData) };
  if (value && typeof value === "object")
    return {
      kind: "object",
      fields: new Map(
        Object.entries(value).map(([key, item]) => [key, fromStaticData(item)]),
      ),
      unknownKeys: false,
    };
  return { kind: "known", value };
}

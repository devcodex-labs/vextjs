import path from "node:path";
import type { VextGenerateChangesInput } from "./contracts.js";
import {
  getInspectionSources,
  getInspectionRoles,
  type VextMcpProjectInspection,
} from "./project-inspector.js";
import type { VextMcpChangeSetFile } from "./change-set.js";
import { filePathToServiceKeys } from "../shared/service-paths.js";
import { ASSISTANT_SOURCE_ROOT } from "../tooling/project-index/analysis-source.js";

export class RecipeInputError extends Error {
  constructor(
    message: string,
    readonly status: "invalid" | "incomplete" | "unsupported" = "invalid",
  ) {
    super(message);
  }
}

export function safeRecipeName(value: string): string {
  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/[ _]+/gu, "-")
    .toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,119}$/u.test(normalized))
    throw new RecipeInputError(
      "name must normalize to a kebab-case identifier.",
    );
  return normalized;
}

export function safeModulePath(value: string): string {
  if (value.includes("\\"))
    throw new RecipeInputError("Module paths must use forward slashes.");
  const parts = value.split("/");
  if (
    parts.length > 4 ||
    parts.some((part) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,119}$/u.test(part))
  )
    throw new RecipeInputError(
      "Expected a relative module/submodule path without traversal.",
    );
  return parts.join("/");
}

export function pascalName(value: string): string {
  return value
    .split(/[-_]/u)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
}
export function camelName(value: string): string {
  const result = pascalName(value);
  return result[0]!.toLowerCase() + result.slice(1);
}
export function indent(source: string, spaces = 2): string {
  return source
    .split("\n")
    .map((line) => (line ? " ".repeat(spaces) + line : line))
    .join("\n");
}

/** 只消费封存上下文；渲染阶段不重新读取磁盘、不执行 formatter 配置或用户代码。 */
export class RecipeContext {
  readonly options: Record<string, unknown>;
  readonly name: string;
  readonly warnings: string[] = [];
  readonly steps: string[] = [];
  readonly prerequisites: string[] = [];
  scaffold = true;
  private readonly view;
  private readonly roles;
  private readonly format: {
    indent: string;
    eol: string;
    singleQuote: boolean;
  };
  private readonly chinese: boolean;
  private readonly commentChinese: boolean;

  constructor(
    readonly input: VextGenerateChangesInput,
    readonly project: VextMcpProjectInspection,
  ) {
    this.name = safeRecipeName(input.name);
    this.options = input.options ?? {};
    this.view = getInspectionSources(project);
    this.roles = getInspectionRoles(project) ?? [];
    const language = project.policy.patch.commentLanguage;
    const comments =
      this.view
        ?.list({ rootId: ASSISTANT_SOURCE_ROOT })
        .filter((file) => /\.[jt]sx?$/u.test(file.path))
        .slice(0, 20)
        .map(
          (file) =>
            (this.view!.read(file.rootId, file.path) ?? "")
              .match(/\/\*[^]*?\*\/|\/\/[^\n]*/gu)
              ?.join("\n") ?? "",
        )
        .join("\n") ?? "";
    this.commentChinese =
      language === "zh" ||
      (language !== "en" &&
        (project.policy.patch.outputLanguage === "zh" ||
          /[\u4e00-\u9fff]/u.test(comments)));
    this.chinese = project.policy.patch.outputLanguage
      ? project.policy.patch.outputLanguage === "zh"
      : this.commentChinese;
    this.format = this.readFormat();
    if (project.policy.patch.architecture)
      this.steps.push(
        `Adopted architecture: ${project.policy.patch.architecture.style}. ${project.policy.patch.architecture.notes ?? ""}`,
      );
    if (project.policy.patch.naming?.service)
      this.steps.push(
        "Service keys follow the framework file-to-key resolver; confirm the generated key rather than renaming runtime injection through a naming policy.",
      );
    this.warnings.push(
      this.message(
        "生成代码只经过静态检查；业务、数据库和浏览器行为仍需宿主验证。",
        "Generated code is statically checked; business, database and browser behavior still require host verification.",
      ),
    );
  }

  message(zh: string, en: string): string {
    return this.chinese ? zh : en;
  }
  option(key: string, fallback: string): string;
  option<T>(key: string, fallback: T): T;
  option<T>(key: string, fallback: T): T {
    return (this.options[key] ?? fallback) as T;
  }
  has(key: string): boolean {
    return Object.hasOwn(this.options, key);
  }
  quote(value: string): string {
    const json = JSON.stringify(value)
      .replaceAll("\u2028", "\\u2028")
      .replaceAll("\u2029", "\\u2029");
    return this.format.singleQuote
      ? "'" +
          json.slice(1, -1).replaceAll("'", "\\'").replaceAll('\\"', '"') +
          "'"
      : json;
  }
  comment(zh: string, en: string): string {
    const description = this.option(
      "description",
      this.commentChinese ? zh : en,
    )
      .replaceAll("*/", "* /")
      .replaceAll("\r", "");
    if (this.project.policy.patch.commentDetail === "minimal")
      return "/** " + description.replaceAll("\n", " ") + " */\n";
    const detail =
      this.project.policy.patch.commentDetail === "detailed"
        ? "\n * @remarks " +
          (this.commentChinese
            ? "运行、错误与边界行为需由调用方的验证流程确认。"
            : "The caller must verify runtime, error and boundary behavior.")
        : "";
    return (
      "/**\n" +
      description
        .split("\n")
        .map((line) => " * " + line)
        .join("\n") +
      detail +
      "\n */\n"
    );
  }
  role(id: string): string {
    const role = this.roles.find((item) => item.id === id);
    const section = this.project.snapshot.sections[id];
    if (
      !section ||
      role?.unresolved ||
      role?.externalRootId ||
      role?.candidate === false
    )
      throw new RecipeInputError(
        `Role ${id} is unavailable, unresolved or read-only.`,
        "unsupported",
      );
    return section.resolvedPath;
  }
  language(role: string): "ts" | "js" {
    const explicit = this.options.language;
    if (explicit === "ts" || explicit === "js") return explicit;
    const directory = this.role(role);
    const kinds = new Set(
      this.view
        ?.list({ rootId: ASSISTANT_SOURCE_ROOT })
        .filter(
          (file) =>
            file.path.startsWith(directory + "/") &&
            !/\.d\.[cm]?ts$/u.test(file.path),
        )
        .flatMap((file) =>
          /\.[cm]?tsx?$/u.test(file.path)
            ? ["ts" as const]
            : /\.[cm]?jsx?$/u.test(file.path)
              ? ["js" as const]
              : [],
        ),
    );
    if (kinds.size === 1) return [...kinds][0]!;
    if (kinds.size > 1)
      throw new RecipeInputError(
        `Role ${role} contains mixed JS/TS; supply options.language.`,
        "incomplete",
      );
    if (this.project.snapshot.language === "unknown")
      throw new RecipeInputError(
        "Project language is unknown; supply options.language.",
        "incomplete",
      );
    return this.project.snapshot.language;
  }
  filePath(role: string, stem = this.name, jsx = false): string {
    const naming = this.project.policy.patch.naming?.file;
    const suffix = stem.endsWith(".test") ? ".test" : "";
    const base = suffix ? stem.slice(0, -suffix.length) : stem;
    const filename =
      (naming === "camelCase"
        ? camelName(base)
        : naming === "PascalCase"
          ? pascalName(base)
          : naming === "preserve"
            ? safeModulePath(this.input.name)
            : base) + suffix;
    const featureFiles: Record<string, string> = {
      routes: "route",
      services: "service",
      schemas: "schema",
      validators: "validator",
      "service-types": "types/service",
      "shared-types": "types/shared",
      "service-constants": "constants",
    };
    if (
      this.project.policy.patch.architecture?.style === "feature" &&
      Object.hasOwn(featureFiles, role) &&
      !this.project.policy.patch.roles?.[role]
    ) {
      return `${this.role("feature-modules")}/${this.name}/${featureFiles[role]}.${this.language(role)}${jsx ? "x" : ""}`;
    }
    return `${this.role(role)}/${filename}.${this.language(role)}${jsx ? "x" : ""}`;
  }
  relative(from: string, to: string): string {
    const relative = path.posix
      .relative(path.posix.dirname(from), to)
      .replace(/\.(ts|tsx|jsx)$/u, ".js");
    return relative.startsWith(".") ? relative : "./" + relative;
  }
  file(
    filePath: string,
    content: string,
    reason: string,
  ): VextMcpChangeSetFile {
    const formatted = /\.[jt]sx?$/u.test(filePath)
      ? content.replace(/^(?: {2})+/gmu, (spaces) =>
          this.format.indent.repeat(spaces.length / 2),
        )
      : content;
    return {
      path: filePath,
      action: "create",
      encoding: "utf8",
      content:
        formatted
          .trimEnd()
          .replaceAll("\r\n", "\n")
          .replaceAll("\n", this.format.eol) + this.format.eol,
      reason,
    };
  }
  serviceKey(file: string): string[] {
    return filePathToServiceKeys(file, this.runtimeRoot("services"));
  }
  runtimeRoot(role: string): string {
    const configuredRuntime = this.project.snapshot.sections[role]?.runtimePath;
    return configuredRuntime
      ? path
          .relative(this.project.identity.rootDir, configuredRuntime)
          .replaceAll("\\", "/")
      : `src/${role}`;
  }
  loaderFacade(
    role: "services" | "routes" | "middlewares" | "plugins" | "models" | "jobs",
    file: VextMcpChangeSetFile,
    stem = this.name,
  ): VextMcpChangeSetFile[] {
    const runtimeRoot = this.runtimeRoot(role);
    if (file.path.startsWith(runtimeRoot + "/")) return [file];
    const facade = `${runtimeRoot}/${stem}.${this.language(role)}`;
    this.steps.push(
      `The ${role} policy changes placement, not the runtime loader. Keep ${facade} as the loader entrypoint.`,
    );
    return [
      file,
      this.file(
        facade,
        `export { default } from ${this.quote(this.relative(facade, file.path))};\n`,
        "Register the user-owned module with the existing runtime loader.",
      ),
    ];
  }
  hostSteps(): string[] {
    let scripts: Record<string, string> = {};
    try {
      scripts =
        JSON.parse(
          this.view?.read(ASSISTANT_SOURCE_ROOT, "package.json") ?? "{}",
        ).scripts ?? {};
    } catch {
      /* 元数据问题由项目检查报告。 */
    }
    const manager = this.project.snapshot.packageManager;
    const scriptNames = [
      "typecheck",
      "test:unit",
      "test:integration",
      "test:int",
      "test:e2e",
      "build",
      "format:check",
    ];
    const commands = scriptNames.flatMap((purpose) => {
      const selected = this.project.policy.patch.scripts?.[purpose] ?? purpose;
      if (!Object.hasOwn(scripts, selected)) return [];
      return manager && /^[a-zA-Z0-9:_-]+$/u.test(selected)
        ? [`${manager} run ${selected}`]
        : [];
    });
    return [
      "Review and apply create-only files against baseIdentity; never overwrite existing files.",
      ...this.steps,
      ...(commands.length
        ? [
            "Run the relevant existing project scripts after applying: " +
              [...new Set(commands)].join("; ") +
              ". Keep focused tests scoped to the changed behavior.",
          ]
        : [
            "No verified validation scripts were found. Select the host's actual typecheck, focused tests, build and formatter commands before claiming completion.",
          ]),
      "Record commands, exit codes and behavior evidence; stop only services started for this verification.",
    ];
  }
  private readFormat() {
    let data: Record<string, unknown> = {};
    for (const file of [".prettierrc", ".prettierrc.json"]) {
      const text = this.view?.read(ASSISTANT_SOURCE_ROOT, file);
      if (!text) continue;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("Expected formatter options");
        data = parsed as Record<string, unknown>;
      } catch {
        this.steps.push(
          `${file} cannot be read as static JSON; run the project's formatter in the host.`,
        );
      }
    }
    const editor =
      this.view?.read(ASSISTANT_SOURCE_ROOT, ".editorconfig") ?? "";
    const global = editor.split(/^\s*\[(?!\*)/mu)[0] ?? "";
    const size = Number(
      data.tabWidth ??
        global.match(/^\s*indent_size\s*=\s*(\d+)\s*$/mu)?.[1] ??
        2,
    );
    const tabs =
      data.useTabs === true || /indent_style\s*=\s*tab/u.test(global);
    if (
      this.view?.record(ASSISTANT_SOURCE_ROOT, "prettier.config.js") ||
      this.view?.record(ASSISTANT_SOURCE_ROOT, "prettier.config.mjs")
    )
      this.steps.push(
        "Dynamic formatter configuration is not executed by MCP; apply it with the existing host formatter.",
      );
    this.steps.push(
      "MCP adopts static indentation, quotes and line endings. Let the project's formatter handle wrapping and remaining style rules on candidate files.",
    );
    return {
      indent: tabs
        ? "\t"
        : " ".repeat(
            Number.isInteger(size) && size >= 1 && size <= 8 ? size : 2,
          ),
      eol:
        data.endOfLine === "crlf" || /end_of_line\s*=\s*crlf/u.test(global)
          ? "\r\n"
          : "\n",
      singleQuote: data.singleQuote === true,
    };
  }
}

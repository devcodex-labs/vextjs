import fs from "node:fs";
import path from "node:path";

/**
 * error-overlay.ts — Dev 模式 HTML 错误覆盖层渲染器
 *
 * 接受一个 Error 对象和 projectRoot 路径，生成完整的 HTML 错误覆盖层字符串。
 * 功能：
 *   - 解析 Error.stack（--enable-source-maps 翻译后为 .ts 路径）
 *   - 区分用户代码帧（展开 + 源码上下文）与内部帧（折叠）
 *   - 支持 dark / light 主题
 *   - vscode:// 链接直接跳转到出错行
 *   - VextValidationError 专属：字段级错误列表
 *   - 最多展示 N 帧（防止超深调用栈撑爆 HTML）
 *
 * 设计约束：
 *   - 不 import 任何框架类型（error-overlay.ts 是框架内部工具，不暴露到公共 API）
 *   - 使用 fs.readFileSync 同步读取（仅 dev 模式错误路径，性能可接受）
 *   - 渲染失败时抛出异常，由外层 error-handler.ts 的 try/catch 降级到 JSON
 *
 * @module lib/dev/error-overlay
 * @see requirements/dev-error-overlay/02-技术方案.md §2.1
 */

// ── 类型定义 ────────────────────────────────────────────────

/**
 * 解析后的堆栈帧
 */
export interface StackFrame {
  /** 函数名（未知时为 '<anonymous>'） */
  fn: string;
  /** 绝对文件路径（--enable-source-maps 翻译后为 .ts） */
  file: string;
  /** 行号（1-based） */
  line: number;
  /** 列号（1-based） */
  col: number;
}

/**
 * 源码上下文（出错行 ±3 行）
 */
export interface SourceContext {
  lines: Array<{
    /** 行号（1-based） */
    num: number;
    /** 行内容（原始文本） */
    content: string;
    /** 是否为出错行（高亮） */
    isError: boolean;
  }>;
}

/**
 * renderDevErrorPage 的可选配置
 */
export interface DevOverlayOptions {
  /** 主题：深色 / 浅色（默认 'dark'） */
  theme?: "dark" | "light";
  /** 最多显示的堆栈帧数（默认 25） */
  maxFrames?: number;
}

// ── 内部工具函数 ────────────────────────────────────────────

/**
 * HTML 特殊字符转义（防止 XSS）
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 解析 Error.stack 字符串为 StackFrame 数组
 *
 * 支持两种格式：
 *   - "    at FunctionName (file:line:col)"
 *   - "    at file:line:col"
 *   - Windows 路径：反斜杠会被处理
 *   - node: 内置模块：file 以 "node:" 开头
 */
export function parseStackTrace(stack: string): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];

  // 支持 "at fn (file:line:col)" 和 "at file:line:col"
  // 注意：file 部分可以是 Windows 路径（含盘符 C:\...）
  const lineRe = /^\s*at\s+(?:([\w$./<>[\] ]+)\s+\()?(.+):(\d+):(\d+)\)?$/;

  for (const line of stack.split("\n")) {
    const m = lineRe.exec(line.trim());
    if (!m) continue;

    const fnRaw = m[1];
    const fileRaw = m[2];
    const lineStr = m[3];
    const colStr = m[4];

    if (!fileRaw || !lineStr || !colStr) continue;

    const lineNum = parseInt(lineStr, 10);
    const colNum = parseInt(colStr, 10);

    if (isNaN(lineNum) || isNaN(colNum)) continue;

    frames.push({
      fn: fnRaw?.trim() || "<anonymous>",
      file: fileRaw.trim(),
      line: lineNum,
      col: colNum,
    });
  }

  return frames;
}

/**
 * 将帧文件路径解析为绝对路径
 *
 * --enable-source-maps 翻译后的堆栈路径存在两种偏差：
 *   A. 相对路径（如 "../src/routes/index.ts"）
 *   B. 绝对但层级偏移（如 "E:/MySelf/src/routes/index.ts"，
 *      实际应为 "E:/MySelf/vext-test/src/routes/index.ts"）
 *
 * 这是因为 esbuild sourcemap 的 sources 路径相对于编译产物目录（.vext/dev/），
 * Node.js --enable-source-maps 解析时可能丢失中间层级。
 *
 * 解析策略（通用后缀匹配，按优先级）：
 *   1. 已是绝对路径且文件存在 → 直接返回
 *   2. "node:" 前缀 → 直接返回
 *   3. 从最长尾部到最短（至少 2 段）逐一拼接 projectRoot 检查是否存在
 *      e.g. "E:\MySelf\src\routes\index.ts" → 尝试 projectRoot/MySelf/src/routes/index.ts（否）
 *                                            → 尝试 projectRoot/src/routes/index.ts（是！）
 *      该策略覆盖 src/、plugins/、middlewares/、services/ 等任意子目录
 *   4. 相对路径 → path.resolve(projectRoot, file)
 *   5. 以上都失败 → 返回原始路径（graceful 降级）
 */
export function resolveFramePath(file: string, projectRoot: string): string {
  if (file.startsWith("node:")) return file;

  // 已是绝对路径且文件存在 → 直接返回
  if (path.isAbsolute(file)) {
    try {
      if (fs.existsSync(file)) return file;
    } catch {
      /* ignore */
    }
  }

  // 通用后缀匹配：尝试所有不少于 2 段的尾部拼接到 projectRoot
  const normalized = file.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  for (let i = 0; i <= parts.length - 2; i++) {
    const tail = parts.slice(i).join("/");
    const candidate = path.join(projectRoot, tail);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }

  // 相对路径 → 相对于 projectRoot 解析
  if (!path.isAbsolute(file)) {
    const resolved = path.resolve(projectRoot, file);
    try {
      if (fs.existsSync(resolved)) return resolved;
    } catch {
      /* ignore */
    }
  }

  return file;
}

/**
 * 判断帧是否为用户代码（而非框架内部或 node_modules）
 *
 * 条件：
 *   1. file 以 projectRoot 开头
 *   2. file 不包含 'node_modules'
 *   3. file 不以 'node:' 开头（Node.js 内置模块）
 *   4. file 不包含 '.vext/dev/'（未翻译的编译产物，--enable-source-maps 应已翻译）
 */
export function isUserFrame(frame: StackFrame, projectRoot: string): boolean {
  const { file } = frame;
  if (file.startsWith("node:")) return false;
  // 规范化路径分隔符用于比较（Windows 兼容）
  const normalizedFile = file.replace(/\\/g, "/");
  const normalizedRoot = projectRoot.replace(/\\/g, "/");
  // 确保以目录分隔符结尾，防止 "project" 错误匹配 "project-other" 前缀
  const rootPrefix = normalizedRoot.endsWith("/")
    ? normalizedRoot
    : normalizedRoot + "/";
  if (!normalizedFile.startsWith(rootPrefix)) return false;
  if (normalizedFile.includes("node_modules")) return false;
  if (normalizedFile.includes("/.vext/dev/")) return false;
  return true;
}

/**
 * 读取文件中指定行号 ±3 行的上下文
 *
 * 边界处理：
 *   - 文件不存在 → 返回 null（E2）
 *   - 文件读取失败 → 返回 null（E3）
 *   - 行号超出范围 → 取可用范围
 */
export function getSourceContext(
  file: string,
  errorLine: number,
): SourceContext | null {
  if (errorLine <= 0 || isNaN(errorLine)) return null;

  try {
    if (!fs.existsSync(file)) return null;

    const content = fs.readFileSync(file, "utf-8");
    const allLines = content.split("\n");
    const totalLines = allLines.length;

    const start = Math.max(0, errorLine - 4); // ±3 行，数组索引从 0
    const end = Math.min(totalLines - 1, errorLine + 2);

    const contextLines = [];
    for (let i = start; i <= end; i++) {
      let lineContent = allLines[i] ?? "";
      // 超长行截断（E9/A4：防止极长行撑爆 HTML）
      if (lineContent.length > 500) {
        lineContent = lineContent.substring(0, 500) + " ... [line truncated]";
      }
      contextLines.push({
        num: i + 1, // 1-based
        content: lineContent,
        isError: i + 1 === errorLine,
      });
    }

    return { lines: contextLines };
  } catch {
    return null;
  }
}

// ── CSS 主题 ────────────────────────────────────────────────

const DARK_THEME = {
  bg: "#0d0d0d",
  text: "#e5e7eb",
  dimText: "#6b7280",
  headerBg: "#111111",
  frameBg: "#161616",
  frameBorder: "#1f1f1f",
  internalFrameOpacity: "0.45",
  errorLineBg: "#3f0000",
  errorLineText: "#fca5a5",
  errorType: "#fc8181",
  errorMsg: "#d1d5db",
  fileLink: "#60a5fa",
  fnColor: "#d4a24c",
  lineNum: "#4b5563",
  badge500Bg: "#7f1d1d",
  badge500Text: "#fca5a5",
  badge4xxBg: "#78350f",
  badge4xxText: "#fcd34d",
  badge2xxBg: "#14532d",
  badge2xxText: "#86efac",
  footerText: "#374151",
  btnBg: "#1f2937",
  btnText: "#9ca3af",
  btnBorder: "#374151",
  valBg: "#1c1208",
  valBorder: "#78350f",
  valFieldText: "#fbbf24",
  valMsgText: "#d1d5db",
  toggleBtnBg: "#1f2937",
  toggleBtnText: "#6b7280",
  toggleBtnBorder: "#374151",
};

const LIGHT_THEME = {
  bg: "#f9fafb",
  text: "#111827",
  dimText: "#6b7280",
  headerBg: "#ffffff",
  frameBg: "#ffffff",
  frameBorder: "#e5e7eb",
  internalFrameOpacity: "0.5",
  errorLineBg: "#fef2f2",
  errorLineText: "#b91c1c",
  errorType: "#dc2626",
  errorMsg: "#374151",
  fileLink: "#2563eb",
  fnColor: "#92400e",
  lineNum: "#9ca3af",
  badge500Bg: "#fee2e2",
  badge500Text: "#b91c1c",
  badge4xxBg: "#fef3c7",
  badge4xxText: "#92400e",
  badge2xxBg: "#d1fae5",
  badge2xxText: "#065f46",
  footerText: "#9ca3af",
  btnBg: "#f3f4f6",
  btnText: "#6b7280",
  btnBorder: "#d1d5db",
  valBg: "#fffbeb",
  valBorder: "#fcd34d",
  valFieldText: "#92400e",
  valMsgText: "#374151",
  toggleBtnBg: "#f3f4f6",
  toggleBtnText: "#6b7280",
  toggleBtnBorder: "#d1d5db",
};

type Theme = typeof DARK_THEME;

// ── HTML 生成 ────────────────────────────────────────────────

/**
 * 生成完整的 CSS 字符串（内联到 <style> 标签）
 */
function buildCss(t: Theme): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
      background: ${t.bg};
      color: ${t.text};
      font-size: 14px;
      line-height: 1.6;
      min-height: 100vh;
    }
    .header {
      background: ${t.headerBg};
      padding: 24px 32px 20px;
      border-bottom: 1px solid ${t.frameBorder};
    }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .badge-500 { background: ${t.badge500Bg}; color: ${t.badge500Text}; }
    .badge-4xx { background: ${t.badge4xxBg}; color: ${t.badge4xxText}; }
    .badge-2xx { background: ${t.badge2xxBg}; color: ${t.badge2xxText}; }
    .error-type {
      font-size: 22px;
      font-weight: 700;
      color: ${t.errorType};
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }
    .error-message {
      font-size: 15px;
      color: ${t.errorMsg};
      word-break: break-word;
      white-space: pre-wrap;
    }
    .main { padding: 24px 32px; max-width: 1100px; }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: ${t.dimText};
      margin: 0 0 12px;
    }
    .val-section {
      margin-bottom: 24px;
      background: ${t.valBg};
      border: 1px solid ${t.valBorder};
      border-radius: 6px;
      padding: 16px 20px;
    }
    .val-error-item {
      display: flex;
      gap: 12px;
      padding: 4px 0;
      border-bottom: 1px solid ${t.frameBorder};
    }
    .val-error-item:last-child { border-bottom: none; }
    .val-field {
      color: ${t.valFieldText};
      font-weight: 600;
      min-width: 120px;
      flex-shrink: 0;
    }
    .val-msg { color: ${t.valMsgText}; }
    .frames-section { margin-bottom: 32px; }
    .stack-frame {
      background: ${t.frameBg};
      border: 1px solid ${t.frameBorder};
      border-radius: 6px;
      margin-bottom: 8px;
      overflow: hidden;
    }
    .stack-frame.internal-frame { opacity: ${t.internalFrameOpacity}; }
    .stack-frame.collapsed .source-context { display: none; }
    .frame-header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      padding: 10px 16px;
      cursor: default;
    }
    .user-frame .frame-header { cursor: pointer; }
    .frame-fn {
      color: ${t.fnColor};
      font-weight: 600;
      font-size: 13px;
      flex-shrink: 0;
    }
    .frame-file {
      color: ${t.fileLink};
      font-size: 12px;
      text-decoration: none;
      word-break: break-all;
    }
    .frame-file:hover { text-decoration: underline; }
    .source-context {
      border-top: 1px solid ${t.frameBorder};
      font-size: 13px;
    }
    .code-line {
      display: flex;
      align-items: stretch;
      min-height: 22px;
    }
    .code-line.error-line {
      background: ${t.errorLineBg};
    }
    .line-num {
      display: inline-block;
      width: 52px;
      text-align: right;
      padding: 2px 12px 2px 0;
      color: ${t.lineNum};
      user-select: none;
      flex-shrink: 0;
      font-size: 12px;
    }
    .error-line .line-num { color: ${t.errorLineText}; font-weight: 700; }
    .line-code {
      padding: 2px 16px;
      white-space: pre;
      overflow-x: auto;
      flex: 1;
    }
    .error-line .line-code { color: ${t.errorLineText}; }
    .toggle-btn {
      background: ${t.toggleBtnBg};
      color: ${t.toggleBtnText};
      border: 1px solid ${t.toggleBtnBorder};
      border-radius: 4px;
      padding: 6px 14px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      margin-top: 4px;
    }
    .toggle-btn:hover { opacity: 0.8; }
    .no-stack {
      color: ${t.dimText};
      font-style: italic;
      padding: 16px 0;
    }
    .footer {
      padding: 16px 32px;
      color: ${t.footerText};
      font-size: 11px;
      border-top: 1px solid ${t.frameBorder};
      margin-top: 32px;
    }
    /* P2: 主帧 — 第一个用户帧红色左边框强调 */
    .primary-frame {
      border-left: 3px solid ${t.errorType};
    }
    /* P1: 列号 ^ 指示符行 */
    .caret-line .line-num { color: ${t.errorType}; }
    .caret-line .line-code {
      color: ${t.errorType};
      font-weight: 700;
      white-space: pre;
    }
    /* P3: Copy Stack 按钮 */
    .copy-btn {
      float: right;
      background: ${t.btnBg};
      color: ${t.btnText};
      border: 1px solid ${t.btnBorder};
      border-radius: 4px;
      padding: 4px 12px;
      font-size: 11px;
      cursor: pointer;
      font-family: inherit;
      margin-top: 2px;
    }
    .copy-btn:hover { opacity: 0.8; }
    .copy-btn.copied { color: #4ade80; border-color: #4ade80; }
  `.trim();
}

/**
 * 将绝对路径转换为相对于 projectRoot 的显示路径（Windows 兼容）
 */
function toDisplayPath(file: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, file);
  return rel.replace(/\\/g, "/");
}

/**
 * 生成 vscode:// 跳转链接（Windows 反斜杠处理）
 */
function toVscodeLink(file: string, line: number, col: number): string {
  const normalizedFile = file.replace(/\\/g, "/");
  return `vscode://file/${normalizedFile}:${line}:${col}`;
}

/**
 * 渲染单个堆栈帧的 HTML
 */
function renderFrame(
  frame: StackFrame,
  projectRoot: string,
  isUser: boolean,
  isPrimary: boolean,
  index: number,
): string {
  const displayPath = toDisplayPath(frame.file, projectRoot);
  const hasValidLine = frame.line > 0 && !isNaN(frame.line);
  const fileLabel = hasValidLine
    ? `${displayPath}:${frame.line}:${frame.col}`
    : displayPath;

  const vsLink =
    hasValidLine && isUser
      ? `<a class="frame-file" href="${escapeHtml(toVscodeLink(frame.file, frame.line, frame.col))}" title="Open in VS Code">${escapeHtml(fileLabel)}</a>`
      : `<span class="frame-file">${escapeHtml(fileLabel)}</span>`;

  let sourceHtml = "";
  if (isUser && hasValidLine) {
    const ctx = getSourceContext(frame.file, frame.line);
    if (ctx && ctx.lines.length > 0) {
      const linesHtml = ctx.lines
        .map((l) => {
          const lineClass = l.isError ? "code-line error-line" : "code-line";
          const lineHtml = `<div class="${lineClass}"><span class="line-num">${l.num}</span><span class="line-code">${escapeHtml(l.content)}</span></div>`;
          // P1: 出错行下方插入列号 ^ 指示符
          if (l.isError && frame.col > 0) {
            const caretPad = " ".repeat(Math.max(0, frame.col - 1));
            const caretHtml = `<div class="code-line caret-line"><span class="line-num"></span><span class="line-code">${escapeHtml(caretPad)}^</span></div>`;
            return lineHtml + caretHtml;
          }
          return lineHtml;
        })
        .join("");
      sourceHtml = `<div class="source-context">${linesHtml}</div>`;
    }
  }

  // P2: 主帧（第一个用户帧）添加 primary-frame class
  const frameClass = isUser
    ? `stack-frame user-frame${isPrimary ? " primary-frame" : ""}`
    : "stack-frame internal-frame collapsed";

  return `
    <div class="${frameClass}" data-frame="${index}">
      <div class="frame-header" onclick="toggleFrame(${index})">
        <span class="frame-fn">${escapeHtml(frame.fn)}</span>
        ${vsLink}
      </div>
      ${sourceHtml}
    </div>`.trim();
}

// ── 公共 API ─────────────────────────────────────────────────

/**
 * renderDevErrorPage — 生成完整的 HTML 错误覆盖层字符串
 *
 * @param err          抛出的错误（任意类型，非 Error 对象会被转换）
 * @param projectRoot  用户项目根目录（绝对路径），用于区分用户帧/内部帧
 * @param options      可选配置（主题、最大帧数）
 * @returns            完整的 HTML 字符串（可直接作为 HTTP 响应体）
 */
export function renderDevErrorPage(
  err: unknown,
  projectRoot: string,
  options?: DevOverlayOptions,
): string {
  const theme = options?.theme ?? "dark";
  const maxFrames = options?.maxFrames ?? 25;
  const t = theme === "light" ? LIGHT_THEME : DARK_THEME;

  // E14: 非 Error 实例兜底
  const error = err instanceof Error ? err : new Error(String(err));

  const errorName = error.name || "Error";
  const errorMessage = error.message || "(no message)";

  // 解析堆栈
  const allFrames = parseStackTrace(error.stack ?? "").slice(0, maxFrames);

  // 🆕 解析帧路径：--enable-source-maps 产生的相对路径 → 绝对路径
  // 必须在 isUserFrame / getSourceContext 使用之前完成
  for (const frame of allFrames) {
    frame.file = resolveFramePath(frame.file, projectRoot);
  }

  // 计算 HTTP 状态码和 badge 类别（通过 name 字符串检测，避免 import 框架类型）
  let statusCode = 500;
  let badgeClass = "badge-500";
  let badgeLabel = "500 Internal Server Error";

  if (error.name === "VextValidationError") {
    statusCode = 422;
    badgeClass = "badge-4xx";
    badgeLabel = "422 Validation Failed";
  } else if (
    error.name === "HttpError" &&
    typeof (error as unknown as Record<string, unknown>).status === "number"
  ) {
    statusCode = (error as unknown as Record<string, unknown>).status as number;
    if (statusCode >= 400 && statusCode < 500) {
      badgeClass = "badge-4xx";
      badgeLabel = `${statusCode} Client Error`;
    } else if (statusCode >= 500) {
      badgeClass = "badge-500";
      badgeLabel = `${statusCode} Server Error`;
    }
  }

  badgeLabel += " · dev mode";

  // VextValidationError 专属：字段级错误列表（E15: errors 为空时不渲染）
  let valSectionHtml = "";
  const errorAsRecord = error as unknown as Record<string, unknown>;
  const validationErrors = errorAsRecord.errors;
  if (
    error.name === "VextValidationError" &&
    Array.isArray(validationErrors) &&
    validationErrors.length > 0
  ) {
    const items = (
      validationErrors as Array<{ field?: string; message?: string }>
    )
      .map(
        (e) =>
          `<div class="val-error-item"><span class="val-field">${escapeHtml(e.field ?? "unknown")}</span><span class="val-msg">${escapeHtml(e.message ?? "")}</span></div>`,
      )
      .join("");
    valSectionHtml = `
      <div class="val-section">
        <p class="section-title">Validation Errors</p>
        ${items}
      </div>`;
  }

  // 渲染堆栈帧
  let framesHtml = "";
  let hasUserFrames = false;

  if (allFrames.length === 0) {
    framesHtml = `<p class="no-stack">No stack trace available.</p>`;
  } else {
    // E5: 过滤掉 node: 内置模块帧（不展示，仅统计为内部帧）
    const visibleFrames = allFrames.filter((f) => !f.file.startsWith("node:"));
    const userFrameIndices = new Set<number>();
    let primaryFrameIdx = -1; // P2: 第一个用户帧索引

    visibleFrames.forEach((f, i) => {
      if (isUserFrame(f, projectRoot)) {
        hasUserFrames = true;
        userFrameIndices.add(i);
        if (primaryFrameIdx === -1) primaryFrameIdx = i; // P2: 记录主帧
      }
    });

    const frameItems = visibleFrames
      .map((f, i) =>
        renderFrame(
          f,
          projectRoot,
          userFrameIndices.has(i),
          i === primaryFrameIdx,
          i,
        ),
      )
      .join("\n");

    const hasInternal = visibleFrames.some((_, i) => !userFrameIndices.has(i));

    framesHtml = frameItems;
    if (hasInternal) {
      framesHtml += `\n<button class="toggle-btn" onclick="toggleAllInternal()">Show / Hide Internal Frames</button>`;
    }
  }

  void hasUserFrames; // suppress unused warning

  const css = buildCss(t);

  // 内联 JS：帧折叠/展开 + P3 Copy Stack
  const js = `
    function toggleFrame(idx) {
      var el = document.querySelector('[data-frame="' + idx + '"]');
      if (el) el.classList.toggle('collapsed');
    }
    function toggleAllInternal() {
      document.querySelectorAll('.internal-frame').forEach(function(el) {
        el.classList.toggle('collapsed');
      });
    }
    function copyStack() {
      var errType = (document.querySelector('.error-type') || {}).textContent || '';
      var errMsg = (document.querySelector('.error-message') || {}).textContent || '';
      var frames = Array.from(document.querySelectorAll('[data-frame]')).map(function(el) {
        var fn = (el.querySelector('.frame-fn') || {}).textContent || '';
        var file = (el.querySelector('.frame-file') || {}).textContent || '';
        return '  at ' + fn + ' (' + file + ')';
      }).join('\\n');
      var text = errType + ': ' + errMsg + '\\n' + frames;
      navigator.clipboard.writeText(text).then(function() {
        var btn = document.querySelector('.copy-btn');
        if (btn) {
          var orig = btn.textContent;
          btn.textContent = 'Copied!';
          btn.classList.add('copied');
          setTimeout(function() { btn.textContent = orig; btn.classList.remove('copied'); }, 2000);
        }
      }).catch(function() {});
    }
  `.trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(errorName)}: ${escapeHtml(errorMessage.substring(0, 60))}</title>
  <style>${css}</style>
</head>
<body>
  <div class="header">
    <button class="copy-btn" onclick="copyStack()">Copy Stack</button>
    <div class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</div>
    <h1 class="error-type">${escapeHtml(errorName)}</h1>
    <p class="error-message">${escapeHtml(errorMessage)}</p>
  </div>
  <div class="main">
    ${valSectionHtml}
    <div class="frames-section">
      <p class="section-title">Stack Trace</p>
      ${framesHtml}
    </div>
  </div>
  <div class="footer">仅开发模式可见 · vext dev · ${statusCode}</div>
  <script>${js}</script>
</body>
</html>`;
}

import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * pid-file.ts — PID 文件读写模块
 *
 * Master 进程启动时将自身 PID 写入文件，
 * CLI 命令（vext stop / vext reload / vext status）通过读取 PID 文件
 * 定位 Master 进程并发送信号。
 *
 * PID 文件生命周期：
 *   1. Master 启动 → writePidFile()  写入 PID
 *   2. CLI 操作   → readPidFile()   读取 PID → 发送信号
 *   3. Master 退出 → removePidFile() 删除文件
 *
 * 文件格式：
 *   - 纯文本，内容仅为 PID 数字 + 换行符
 *   - 默认路径：项目根目录下 `.vext.pid`
 *   - 可通过 config.cluster.pidFile 或 VEXT_CLUSTER_PID 环境变量自定义
 *
 * 安全性考虑：
 *   - writePidFile 检测是否已有同名文件，若对应进程仍存活则拒绝写入（防止多实例冲突）
 *   - removePidFile 验证文件内容与当前 PID 一致后才删除（防止误删其他实例的 PID 文件）
 *   - 所有操作使用同步 API（启动/关闭阶段，无需异步）
 *
 * @module lib/cluster/pid-file
 * @see 12a-master.md §3（PID 文件）
 * @see 12d-deploy.md §2（PID 文件路径与多项目隔离）
 */

// ── 常量 ────────────────────────────────────────────────────

/** 默认 PID 文件路径（相对于项目根目录） */
export const DEFAULT_PID_FILE = ".vext.pid";

// ── 类型定义 ────────────────────────────────────────────────

/**
 * PID 文件操作结果
 */
export interface PidFileResult {
  /** 操作是否成功 */
  ok: boolean;
  /** PID 值（读取时返回） */
  pid?: number;
  /** 错误信息（失败时返回） */
  error?: string;
  /** PID 文件的绝对路径 */
  path: string;
}

// ── 主函数 ──────────────────────────────────────────────────

/**
 * writePidFile — 写入 PID 文件
 *
 * Master 启动时调用，将当前进程 PID 写入文件。
 *
 * 冲突检测：
 *   - 如果 PID 文件已存在，读取其中的 PID
 *   - 检测该 PID 对应的进程是否仍存活（process.kill(pid, 0)）
 *   - 存活 → 拒绝写入，返回错误（防止多实例冲突）
 *   - 不存活 → 覆盖写入（上次异常退出残留的 stale PID 文件）
 *
 * @param pidFilePath PID 文件路径（绝对路径或相对于 cwd 的路径）
 * @param pid 要写入的 PID（默认 process.pid）
 * @returns 操作结果
 */
export function writePidFile(
  pidFilePath: string = DEFAULT_PID_FILE,
  pid: number = process.pid,
): PidFileResult {
  const absolutePath = resolve(pidFilePath);

  // ── 冲突检测 ──────────────────────────────────────────
  if (existsSync(absolutePath)) {
    try {
      const existingPid = parseInt(
        readFileSync(absolutePath, "utf-8").trim(),
        10,
      );

      if (!Number.isNaN(existingPid) && existingPid > 0) {
        if (isProcessAlive(existingPid)) {
          return {
            ok: false,
            pid: existingPid,
            path: absolutePath,
            error:
              `PID file "${absolutePath}" already exists and process ${existingPid} is still running. ` +
              `Another instance may be active. Remove the PID file manually if this is incorrect.`,
          };
        }
        // 进程已不存在 → stale PID 文件，允许覆盖
      }
    } catch {
      // PID 文件存在但无法读取 → 尝试覆盖
    }
  }

  // ── 确保父目录存在 ────────────────────────────────────
  try {
    const dir = dirname(absolutePath);
    mkdirSync(dir, { recursive: true });
  } catch {
    // 目录已存在或无法创建（后续 writeFileSync 会报错）
  }

  // ── 写入 PID ──────────────────────────────────────────
  try {
    writeFileSync(absolutePath, `${pid}\n`, { encoding: "utf-8", mode: 0o644 });
    return {
      ok: true,
      pid,
      path: absolutePath,
    };
  } catch (err) {
    return {
      ok: false,
      path: absolutePath,
      error: `Failed to write PID file "${absolutePath}": ${(err as Error).message}`,
    };
  }
}

/**
 * readPidFile — 读取 PID 文件
 *
 * CLI 命令（vext stop / reload / status）调用，获取 Master 进程 PID。
 *
 * 额外验证：
 *   - 检查文件是否存在
 *   - 解析内容为数字
 *   - 可选：验证对应进程是否存活
 *
 * @param pidFilePath PID 文件路径
 * @param checkAlive 是否验证进程存活（默认 true）
 * @returns 操作结果（包含 pid）
 */
export function readPidFile(
  pidFilePath: string = DEFAULT_PID_FILE,
  checkAlive: boolean = true,
): PidFileResult {
  const absolutePath = resolve(pidFilePath);

  if (!existsSync(absolutePath)) {
    return {
      ok: false,
      path: absolutePath,
      error: `PID file "${absolutePath}" not found. Is the server running?`,
    };
  }

  let content: string;
  try {
    content = readFileSync(absolutePath, "utf-8").trim();
  } catch (err) {
    return {
      ok: false,
      path: absolutePath,
      error: `Failed to read PID file "${absolutePath}": ${(err as Error).message}`,
    };
  }

  const pid = parseInt(content, 10);
  if (Number.isNaN(pid) || pid <= 0) {
    return {
      ok: false,
      path: absolutePath,
      error: `PID file "${absolutePath}" contains invalid content: "${content}"`,
    };
  }

  // ── 可选：验证进程存活 ────────────────────────────────
  if (checkAlive && !isProcessAlive(pid)) {
    return {
      ok: false,
      pid,
      path: absolutePath,
      error:
        `PID file "${absolutePath}" contains PID ${pid}, but the process is not running. ` +
        `This may be a stale PID file from a previous crash.`,
    };
  }

  return {
    ok: true,
    pid,
    path: absolutePath,
  };
}

/**
 * removePidFile — 删除 PID 文件
 *
 * Master 优雅关闭时调用。
 *
 * 安全措施：
 *   - 验证文件内容与当前进程 PID 一致后才删除
 *   - 不一致时跳过删除（可能被其他实例覆盖）
 *   - 删除失败不抛出异常（关闭流程不应因 PID 文件失败而中断）
 *
 * @param pidFilePath PID 文件路径
 * @param expectedPid 期望的 PID（默认 process.pid），用于安全校验
 * @returns 操作结果
 */
export function removePidFile(
  pidFilePath: string = DEFAULT_PID_FILE,
  expectedPid: number = process.pid,
): PidFileResult {
  const absolutePath = resolve(pidFilePath);

  if (!existsSync(absolutePath)) {
    // 文件不存在，无需删除（可能已被手动删除或从未创建）
    return {
      ok: true,
      path: absolutePath,
    };
  }

  // ── 安全校验：验证 PID 一致性 ────────────────────────
  try {
    const content = readFileSync(absolutePath, "utf-8").trim();
    const filePid = parseInt(content, 10);

    if (!Number.isNaN(filePid) && filePid > 0 && filePid !== expectedPid) {
      // PID 不一致 → 可能已被其他实例覆盖，不删除
      return {
        ok: false,
        pid: filePid,
        path: absolutePath,
        error:
          `PID file "${absolutePath}" contains PID ${filePid}, ` +
          `but expected ${expectedPid}. Skipping removal to avoid deleting another instance's PID file.`,
      };
    }
  } catch {
    // 读取失败 → 仍然尝试删除（可能是损坏的文件）
  }

  // ── 删除文件 ──────────────────────────────────────────
  try {
    unlinkSync(absolutePath);
    return {
      ok: true,
      pid: expectedPid,
      path: absolutePath,
    };
  } catch (err) {
    return {
      ok: false,
      path: absolutePath,
      error: `Failed to remove PID file "${absolutePath}": ${(err as Error).message}`,
    };
  }
}

// ── 辅助函数 ────────────────────────────────────────────────

/**
 * isProcessAlive — 检测指定 PID 的进程是否仍然存活
 *
 * 使用 process.kill(pid, 0) 检测：
 *   - 不发送任何信号（signal = 0 是探测信号）
 *   - 成功 → 进程存在且当前用户有权限
 *   - ESRCH → 进程不存在
 *   - EPERM → 进程存在但无权限（仍视为存活）
 *
 * @param pid 要检测的进程 PID
 * @returns 进程是否存活
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    // EPERM = 进程存在但无权限发送信号 → 视为存活
    if (error.code === "EPERM") {
      return true;
    }
    // ESRCH = 进程不存在
    return false;
  }
}

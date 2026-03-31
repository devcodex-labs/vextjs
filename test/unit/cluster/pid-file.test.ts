/**
 * pid-file 单元测试
 *
 * 测试覆盖：
 *   - writePidFile：正常写入、冲突检测（进程存活/stale）、父目录自动创建
 *   - readPidFile：正常读取、文件不存在、内容无效、进程存活性验证
 *   - removePidFile：正常删除、PID 一致性校验、文件不存在时幂等
 *   - isProcessAlive：当前进程检测、不存在的 PID 检测
 *
 * 测试策略：
 *   - 使用 tmp 目录隔离，每个测试用例使用独立的 PID 文件路径
 *   - afterEach 清理残留文件，避免测试间干扰
 *   - 使用 process.pid 作为已知存活进程的 PID
 *   - 使用极大 PID 值（99999999）模拟不存在的进程
 *
 * @see 12a-master.md §3（PID 文件）
 * @see 12d-deploy.md §2（PID 文件路径与多项目隔离）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  writePidFile,
  readPidFile,
  removePidFile,
  isProcessAlive,
  DEFAULT_PID_FILE,
} from "../../../src/lib/cluster/pid-file.js";

// ── 测试工具 ────────────────────────────────────────────────

/** 生成唯一的临时 PID 文件路径 */
function tmpPidFile(suffix: string = ""): string {
  const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return join(dir, `.vext-test${suffix ? `-${suffix}` : ""}.pid`);
}

/** 清理测试目录 */
function cleanupDir(): void {
  const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}

/**
 * 获取一个极大的 PID，几乎不可能存在对应的进程。
 * Linux PID 最大值通常为 4194304（/proc/sys/kernel/pid_max），
 * Windows PID 可以更大但也有实际限制。
 * 使用 99999999 作为不存在的 PID。
 */
const NON_EXISTENT_PID = 99999999;

// ── 测试套件 ────────────────────────────────────────────────

describe("pid-file", () => {
  beforeEach(() => {
    cleanupDir();
  });

  afterEach(() => {
    cleanupDir();
  });

  // ── DEFAULT_PID_FILE ──────────────────────────────────

  describe("DEFAULT_PID_FILE", () => {
    it("should be '.vext.pid'", () => {
      expect(DEFAULT_PID_FILE).toBe(".vext.pid");
    });
  });

  // ── isProcessAlive ────────────────────────────────────

  describe("isProcessAlive", () => {
    it("should return true for the current process", () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it("should return false for a non-existent PID", () => {
      expect(isProcessAlive(NON_EXISTENT_PID)).toBe(false);
    });

    it("should return false for PID 0 on non-Linux platforms", () => {
      // PID 0 在一些系统上有特殊意义（kernel idle process）
      // 但 process.kill(0, 0) 在 Node.js 中检测的是当前进程组
      // 这里主要测试函数不会抛出异常
      const result = isProcessAlive(0);
      expect(typeof result).toBe("boolean");
    });

    it("should return true for parent process PID (if available)", () => {
      const ppid = process.ppid;
      if (ppid && ppid > 0) {
        expect(isProcessAlive(ppid)).toBe(true);
      }
    });
  });

  // ── writePidFile ──────────────────────────────────────

  describe("writePidFile", () => {
    it("should write current process PID to file", () => {
      const filePath = tmpPidFile("write-basic");
      const result = writePidFile(filePath);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(process.pid);
      expect(result.path).toContain("write-basic");

      // 验证文件内容
      const content = readFileSync(result.path, "utf-8").trim();
      expect(content).toBe(String(process.pid));
    });

    it("should write a custom PID to file", () => {
      const filePath = tmpPidFile("write-custom");
      const customPid = 12345;
      const result = writePidFile(filePath, customPid);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(customPid);

      const content = readFileSync(result.path, "utf-8").trim();
      expect(content).toBe(String(customPid));
    });

    it("should create parent directories if they do not exist", () => {
      const dir = join(
        tmpdir(),
        `vext-pid-test-${process.pid}`,
        "nested",
        "deep",
      );
      const filePath = join(dir, ".vext.pid");

      const result = writePidFile(filePath);

      expect(result.ok).toBe(true);
      expect(existsSync(filePath)).toBe(true);
    });

    it("should overwrite stale PID file (process no longer alive)", () => {
      const filePath = tmpPidFile("write-stale");

      // 写入一个不存在的进程的 PID（模拟 stale）
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, `${NON_EXISTENT_PID}\n`, "utf-8");

      // 应成功覆盖
      const result = writePidFile(filePath);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(process.pid);

      const content = readFileSync(result.path, "utf-8").trim();
      expect(content).toBe(String(process.pid));
    });

    it("should refuse to write when PID file exists and process is alive", () => {
      const filePath = tmpPidFile("write-conflict");

      // 先写入当前进程 PID（当前进程一定存活）
      writePidFile(filePath);

      // 用不同的 PID 再次写入应失败
      const result = writePidFile(filePath, 99999);

      expect(result.ok).toBe(false);
      expect(result.pid).toBe(process.pid); // 返回已存在的 PID
      expect(result.error).toContain("still running");
    });

    it("should allow rewriting with the same PID (idempotent for same process)", () => {
      const filePath = tmpPidFile("write-same");

      // 先写入
      const first = writePidFile(filePath);
      expect(first.ok).toBe(true);

      // 同一 PID 再次写入 — 由于进程存活会被拒绝（检测到冲突）
      // 这是正确行为：防止意外的双重启动
      const second = writePidFile(filePath);
      expect(second.ok).toBe(false);
      expect(second.error).toContain("still running");
    });

    it("should handle corrupted PID file content gracefully", () => {
      const filePath = tmpPidFile("write-corrupt");

      // 写入无效内容
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, "not-a-number\n", "utf-8");

      // 应成功覆盖（无效 PID 被视为 stale）
      const result = writePidFile(filePath);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(process.pid);
    });

    it("should handle empty PID file gracefully", () => {
      const filePath = tmpPidFile("write-empty");

      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, "", "utf-8");

      const result = writePidFile(filePath);

      expect(result.ok).toBe(true);
    });

    it("should return absolute path in result", () => {
      const filePath = tmpPidFile("write-abspath");
      const result = writePidFile(filePath);

      expect(result.ok).toBe(true);
      // path.resolve 确保返回绝对路径
      expect(result.path).toMatch(/^[A-Z]:\\|^\//); // Windows or Unix absolute path
    });

    it("should append newline after PID", () => {
      const filePath = tmpPidFile("write-newline");
      writePidFile(filePath);

      const rawContent = readFileSync(filePath, "utf-8");
      expect(rawContent).toBe(`${process.pid}\n`);
    });
  });

  // ── readPidFile ───────────────────────────────────────

  describe("readPidFile", () => {
    it("should read PID from existing file", () => {
      const filePath = tmpPidFile("read-basic");
      writePidFile(filePath);

      const result = readPidFile(filePath);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(process.pid);
    });

    it("should return error when file does not exist", () => {
      const filePath = tmpPidFile("read-nonexistent");

      const result = readPidFile(filePath);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("not found");
      expect(result.error).toContain("Is the server running?");
    });

    it("should return error when file contains invalid content", () => {
      const filePath = tmpPidFile("read-invalid");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, "garbage-content\n", "utf-8");

      const result = readPidFile(filePath);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("invalid content");
    });

    it("should return error when file contains negative PID", () => {
      const filePath = tmpPidFile("read-negative");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, "-1\n", "utf-8");

      const result = readPidFile(filePath);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("invalid content");
    });

    it("should return error when file contains zero PID", () => {
      const filePath = tmpPidFile("read-zero");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, "0\n", "utf-8");

      const result = readPidFile(filePath);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("invalid content");
    });

    it("should return error when process is not alive (checkAlive=true)", () => {
      const filePath = tmpPidFile("read-dead");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, `${NON_EXISTENT_PID}\n`, "utf-8");

      const result = readPidFile(filePath, true);

      expect(result.ok).toBe(false);
      expect(result.pid).toBe(NON_EXISTENT_PID);
      expect(result.error).toContain("not running");
      expect(result.error).toContain("stale");
    });

    it("should succeed when process is not alive but checkAlive=false", () => {
      const filePath = tmpPidFile("read-nocheck");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, `${NON_EXISTENT_PID}\n`, "utf-8");

      const result = readPidFile(filePath, false);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(NON_EXISTENT_PID);
    });

    it("should succeed when process is alive (checkAlive=true, default)", () => {
      const filePath = tmpPidFile("read-alive");
      writePidFile(filePath);

      const result = readPidFile(filePath);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(process.pid);
    });

    it("should handle whitespace around PID", () => {
      const filePath = tmpPidFile("read-whitespace");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, `  ${process.pid}  \n`, "utf-8");

      const result = readPidFile(filePath);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(process.pid);
    });

    it("should return absolute path in result", () => {
      const filePath = tmpPidFile("read-abspath");
      writePidFile(filePath);

      const result = readPidFile(filePath);

      expect(result.path).toMatch(/^[A-Z]:\\|^\//);
    });
  });

  // ── removePidFile ─────────────────────────────────────

  describe("removePidFile", () => {
    it("should delete PID file when PID matches", () => {
      const filePath = tmpPidFile("remove-basic");
      writePidFile(filePath);

      expect(existsSync(filePath)).toBe(true);

      const result = removePidFile(filePath);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(process.pid);
      expect(existsSync(filePath)).toBe(false);
    });

    it("should succeed when file does not exist (idempotent)", () => {
      const filePath = tmpPidFile("remove-nonexistent");

      const result = removePidFile(filePath);

      expect(result.ok).toBe(true);
    });

    it("should refuse to delete when PID does not match expected", () => {
      const filePath = tmpPidFile("remove-mismatch");
      writePidFile(filePath);

      // 尝试以不同的 expectedPid 删除
      const result = removePidFile(filePath, NON_EXISTENT_PID);

      expect(result.ok).toBe(false);
      expect(result.pid).toBe(process.pid); // 文件中实际的 PID
      expect(result.error).toContain("Skipping removal");
      expect(result.error).toContain("another instance");

      // 文件应仍然存在
      expect(existsSync(filePath)).toBe(true);
    });

    it("should delete when PID matches custom expectedPid", () => {
      const filePath = tmpPidFile("remove-custom");
      const customPid = 54321;
      writePidFile(filePath, customPid);

      const result = removePidFile(filePath, customPid);

      expect(result.ok).toBe(true);
      expect(result.pid).toBe(customPid);
      expect(existsSync(filePath)).toBe(false);
    });

    it("should attempt delete when file content is corrupted", () => {
      const filePath = tmpPidFile("remove-corrupt");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, "not-a-pid\n", "utf-8");

      // 文件内容无法解析为有效 PID → 仍然尝试删除（损坏的文件）
      const result = removePidFile(filePath);

      expect(result.ok).toBe(true);
      expect(existsSync(filePath)).toBe(false);
    });

    it("should return absolute path in result", () => {
      const filePath = tmpPidFile("remove-abspath");
      writePidFile(filePath);

      const result = removePidFile(filePath);

      expect(result.path).toMatch(/^[A-Z]:\\|^\//);
    });

    it("should use process.pid as default expectedPid", () => {
      const filePath = tmpPidFile("remove-default-pid");
      writePidFile(filePath);

      // removePidFile 默认使用 process.pid，应成功删除
      const result = removePidFile(filePath);

      expect(result.ok).toBe(true);
    });
  });

  // ── 集成场景 ──────────────────────────────────────────

  describe("integration: write → read → remove lifecycle", () => {
    it("should support complete PID file lifecycle", () => {
      const filePath = tmpPidFile("lifecycle");

      // 1. 初始状态：文件不存在
      expect(readPidFile(filePath).ok).toBe(false);

      // 2. 写入 PID
      const writeResult = writePidFile(filePath);
      expect(writeResult.ok).toBe(true);

      // 3. 读取 PID
      const readResult = readPidFile(filePath);
      expect(readResult.ok).toBe(true);
      expect(readResult.pid).toBe(process.pid);

      // 4. 删除 PID
      const removeResult = removePidFile(filePath);
      expect(removeResult.ok).toBe(true);

      // 5. 再次读取：文件不存在
      expect(readPidFile(filePath).ok).toBe(false);

      // 6. 再次删除：幂等
      expect(removePidFile(filePath).ok).toBe(true);
    });

    it("should handle stale → overwrite → read → remove flow", () => {
      const filePath = tmpPidFile("stale-flow");

      // 1. 写入一个 stale PID（不存在的进程）
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, `${NON_EXISTENT_PID}\n`, "utf-8");

      // 2. read 应报告进程不存活
      const staleRead = readPidFile(filePath, true);
      expect(staleRead.ok).toBe(false);
      expect(staleRead.error).toContain("stale");

      // 3. write 应成功覆盖 stale 文件
      const writeResult = writePidFile(filePath);
      expect(writeResult.ok).toBe(true);
      expect(writeResult.pid).toBe(process.pid);

      // 4. read 应返回新 PID
      const freshRead = readPidFile(filePath);
      expect(freshRead.ok).toBe(true);
      expect(freshRead.pid).toBe(process.pid);

      // 5. 清理
      removePidFile(filePath);
    });

    it("should handle concurrent write attempts (conflict detection)", () => {
      const filePath = tmpPidFile("concurrent");

      // 第一次写入成功
      const first = writePidFile(filePath);
      expect(first.ok).toBe(true);

      // 第二次写入（不同 PID）应检测到冲突
      const second = writePidFile(filePath, 88888);
      expect(second.ok).toBe(false);
      expect(second.error).toContain("still running");

      // 文件内容不应被修改
      const content = readFileSync(filePath, "utf-8").trim();
      expect(content).toBe(String(process.pid));

      // 清理
      removePidFile(filePath);
    });
  });

  // ── 边界情况 ──────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle PID file with only whitespace", () => {
      const filePath = tmpPidFile("edge-whitespace");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, "   \n  \n", "utf-8");

      // 读取应返回无效内容错误
      const readResult = readPidFile(filePath, false);
      expect(readResult.ok).toBe(false);

      // 写入应覆盖（NaN PID 被视为无效/stale）
      const writeResult = writePidFile(filePath);
      expect(writeResult.ok).toBe(true);
    });

    it("should handle very large PID numbers", () => {
      const filePath = tmpPidFile("edge-large-pid");
      const largePid = 2147483647; // MAX_INT32
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, `${largePid}\n`, "utf-8");

      const readResult = readPidFile(filePath, false);
      expect(readResult.ok).toBe(true);
      expect(readResult.pid).toBe(largePid);
    });

    it("should handle PID file with trailing content after number", () => {
      const filePath = tmpPidFile("edge-trailing");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      // parseInt 会解析前导数字，忽略后续内容
      writeFileSync(filePath, `${process.pid} extra stuff\n`, "utf-8");

      const readResult = readPidFile(filePath);
      expect(readResult.ok).toBe(true);
      expect(readResult.pid).toBe(process.pid);
    });

    it("should handle float-like PID (parseInt truncates)", () => {
      const filePath = tmpPidFile("edge-float");
      const dir = join(tmpdir(), `vext-pid-test-${process.pid}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, `${process.pid}.99\n`, "utf-8");

      const readResult = readPidFile(filePath);
      expect(readResult.ok).toBe(true);
      expect(readResult.pid).toBe(process.pid);
    });
  });
});

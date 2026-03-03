import fs from "node:fs";

/**
 * detect-polling.ts — 容器环境检测与 polling 降级判断（Phase 2A）
 *
 * 在 Docker / Kubernetes / WSL2 等容器或虚拟化环境中，
 * `fs.watch`（基于 inotify / FSEvents / ReadDirectoryChangesW）可能无法
 * 正确检测 bind mount 挂载卷上的文件变更。
 *
 * 此模块自动检测运行环境，决定是否需要降级为 polling 模式：
 *
 * | 环境                      | 监听方式   | 配置方式                  |
 * |---------------------------|-----------|--------------------------|
 * | macOS / Windows / Linux   | fs.watch  | 默认即可                  |
 * | Docker (bind mount)       | polling   | 自动检测或 VEXT_DEV_POLL=1 |
 * | Docker (volume)           | fs.watch  | 默认即可                  |
 * | WSL2 (跨文件系统)          | polling   | VEXT_DEV_POLL=1           |
 *
 * 检测优先级：
 *   1. 环境变量 VEXT_DEV_POLL 显式设置 → 使用设置值
 *   2. 检测到容器 + bind mount → 使用 polling
 *   3. 默认不使用 polling（fs.watch 通常可靠）
 *
 * @module lib/dev/detect-polling
 * @see 11c-file-watcher.md §5（自动检测容器环境）
 * @see IMPLEMENTATION-PLAN.md 任务 2.3
 */

// ── 主函数 ──────────────────────────────────────────────────

/**
 * shouldUsePolling — 判断是否需要使用 polling 模式
 *
 * @returns true 表示应使用 polling，false 表示使用 fs.watch
 */
export function shouldUsePolling(): boolean {
  // ── 1. 显式设置（最高优先级）──────────────────────────
  //
  // 用户通过环境变量或 CLI 选项显式控制：
  //   VEXT_DEV_POLL=1  → 强制使用 polling
  //   VEXT_DEV_POLL=0  → 强制不使用 polling
  //
  if (process.env.VEXT_DEV_POLL === "1") return true;
  if (process.env.VEXT_DEV_POLL === "0") return false;

  // ── 2. 自动检测容器环境 ────────────────────────────────
  //
  // 只在 Linux 上执行容器检测（macOS/Windows 不存在 Docker bind mount 问题，
  // 它们使用各自平台的原生文件监听机制，与 Docker Desktop 的 grpcfuse/virtiofs 协作良好）。
  //
  if (process.platform !== "linux") {
    return false;
  }

  if (isInContainer()) {
    return checkBindMount();
  }

  return false;
}

// ── 容器检测 ────────────────────────────────────────────────

/**
 * isInContainer — 检测当前进程是否运行在容器内
 *
 * 检测方法（按可靠性排序）：
 *   1. /.dockerenv 文件存在 → Docker 容器
 *   2. /proc/1/cgroup 包含 docker/kubepods/containerd 关键字 → 容器运行时
 *
 * 注意：这些检测方法可能在某些非标准容器运行时中失效，
 * 但覆盖了绝大多数用户场景（Docker、Docker Compose、Kubernetes）。
 *
 * @returns true 表示在容器内
 */
export function isInContainer(): boolean {
  try {
    // 方法 A：检查 /.dockerenv 文件（Docker 容器标志文件）
    if (fs.existsSync("/.dockerenv")) {
      return true;
    }
  } catch {
    // 无权限访问根目录，继续下一个检测方法
  }

  try {
    // 方法 B：检查 cgroup（兼容更多容器运行时）
    //
    // /proc/1/cgroup 记录了 PID 1 进程所在的 cgroup 层级，
    // 容器运行时通常会在 cgroup 路径中包含自身标识：
    //   - Docker: /docker/<container-id>
    //   - Kubernetes: /kubepods/...
    //   - containerd: /system.slice/containerd-...
    //
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf-8");
    if (
      cgroup.includes("docker") ||
      cgroup.includes("kubepods") ||
      cgroup.includes("containerd")
    ) {
      return true;
    }
  } catch {
    // 非 Linux 系统或无权限读取 /proc — 不是容器环境
  }

  return false;
}

// ── Bind Mount 检测 ─────────────────────────────────────────

/**
 * checkBindMount — 检查工作目录是否为 bind mount
 *
 * bind mount 的文件系统通常是 ext4/xfs/ntfs 等宿主机类型，
 * 而非 overlay（Docker 层文件系统）。
 * bind mount 上 inotify 不工作是 Linux 内核已知限制。
 *
 * 检测方法：
 *   读取 /proc/mounts，检查当前工作目录或 /app 挂载点
 *   是否使用非 overlay 文件系统。
 *
 * @returns true 表示检测到 bind mount（应使用 polling）
 */
export function checkBindMount(): boolean {
  try {
    const mounts = fs.readFileSync("/proc/mounts", "utf-8");

    // 检查常见的 bind mount 特征
    // 如果 /app 或工作目录使用非 overlay 文件系统，很可能是 bind mount
    const cwd = process.cwd();
    const lines = mounts.split("\n");

    for (const line of lines) {
      if (line.includes(cwd) || line.includes("/app")) {
        // bind mount 通常不是 overlay
        if (!line.includes("overlay")) {
          return true;
        }
      }
    }
  } catch {
    // 无法读取 /proc/mounts 信息
  }

  // 保守策略：在容器内但无法确认 bind mount → 仍使用 polling
  //
  // 理由：bind mount 上 inotify 不工作是已知问题，
  // polling 模式虽然性能稍差（1s 延迟），但不会丢失文件变更事件。
  // 宁可多用 polling 也不能丢失事件。
  return true;
}

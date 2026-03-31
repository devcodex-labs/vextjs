import { networkInterfaces } from "node:os";

// ── 类型定义 ────────────────────────────────────────────────

interface ReadyLogOptions {
  /** 日志前缀，如 '[vextjs]' 或 '[vext dev]' */
  prefix: string;
  /** 附加后缀（括号说明），如 '(soft reload enabled)'；省略时不附加 */
  suffix?: string;
}

// ── 工具函数 ────────────────────────────────────────────────

/**
 * 获取本机所有非 loopback 的 IPv4 地址
 *
 * 通过 `os.networkInterfaces()` 枚举所有网络接口，
 * 过滤出 IPv4 且非 loopback（internal=false）的地址。
 *
 * 用途：在 host=0.0.0.0 时展示局域网可访问的实际 IP。
 *
 * @returns 非 loopback IPv4 地址列表（可能为空数组，如纯 loopback 环境）
 */
export function getNetworkAddresses(): string[] {
  const nets = networkInterfaces();
  const result: string[] = [];

  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        result.push(iface.address);
      }
    }
  }

  return result;
}

/**
 * 打印 ready 启动日志
 *
 * 根据监听地址决定输出格式：
 *
 * - `host=0.0.0.0` 或 `::` → 多行展示：
 *     [prefix] ready [suffix]
 *       ➜  Local:   http://localhost:PORT
 *       ➜  Local:   http://127.0.0.1:PORT
 *       ➜  Network: http://<实际IP>:PORT  （每个非 loopback 网卡各一行）
 *
 * - 其他 host（具体 IP）→ 单行原样输出：
 *     [prefix] ready on http://HOST:PORT [suffix]
 *
 * 无可用网卡时（如纯 Docker loopback 环境）优雅降级，
 * 仍输出 Local 双行，Network 行省略。
 *
 * @param logger  框架 logger 实例（需实现 `.info(msg: string)`）
 * @param host    实际监听地址（来自 serverHandle.host）
 * @param port    实际监听端口（来自 serverHandle.port）
 * @param options 前缀与后缀配置
 */
export function printReadyLog(
  logger: { info(msg: string): void },
  host: string,
  port: number,
  options: ReadyLogOptions,
): void {
  const { prefix, suffix } = options;
  const suffixPart = suffix ? ` ${suffix}` : "";
  const isAllInterfaces = host === "0.0.0.0" || host === "::";

  if (isAllInterfaces) {
    logger.info(`${prefix} ready${suffixPart}`);
    logger.info(`  ➜  Local:   http://localhost:${port}`);
    logger.info(`  ➜  Local:   http://127.0.0.1:${port}`);

    const networkAddrs = getNetworkAddresses();
    for (const addr of networkAddrs) {
      logger.info(`  ➜  Network: http://${addr}:${port}`);
    }
  } else {
    logger.info(`${prefix} ready on http://${host}:${port}${suffixPart}`);
  }
}

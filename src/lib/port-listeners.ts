import { isIP } from "node:net";

/** 系统工具只负责提供监听事实；无法确定唯一归属时不能返回可执行 PID。 */
export interface PortListener {
  address: string;
  port: number;
  pid?: number;
  command?: string;
}

function positivePid(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function normalizeAddress(value: string): string | undefined {
  const address = value.replace(/^\[|\]$/g, "");
  if (address === "*" || isIP(address) === 4) return address;
  if (isIP(address) !== 6) return undefined;
  const [ip, zone] = address.split("%");
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = normalized.match(/^::ffff:([\da-f]+):([\da-f]+)$/);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16);
    const low = parseInt(mapped[2]!, 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return zone ? `${normalized}%${zone}` : normalized;
}

function endpoint(
  value: string,
): Pick<PortListener, "address" | "port"> | undefined {
  const separator = value.lastIndexOf(":");
  if (separator < 1) return undefined;
  const rawPort = value.slice(separator + 1);
  if (!/^\d+$/.test(rawPort)) return undefined;
  const port = Number(rawPort);
  const address = normalizeAddress(value.slice(0, separator));
  if (!address || port < 1 || port > 65535) return undefined;
  return { address, port };
}

export function parseNetstatListeners(stdout: string): PortListener[] {
  const listeners: PortListener[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [protocol, local, , state, pid] = line.trim().split(/\s+/);
    if (protocol !== "TCP" || state?.toUpperCase() !== "LISTENING" || !local)
      continue;
    const parsed = endpoint(local);
    if (parsed) listeners.push({ ...parsed, pid: positivePid(pid ?? "") });
  }
  return listeners;
}

export function parseLsofListeners(stdout: string): PortListener[] {
  const listeners: PortListener[] = [];
  let pid: number | undefined;
  let command: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const value = line.slice(1);
    if (line[0] === "p") {
      pid = positivePid(value);
      command = undefined;
    } else if (line[0] === "c") {
      command = value;
    } else if (line[0] === "n") {
      const parsed = endpoint(value);
      if (parsed) listeners.push({ ...parsed, pid, command });
    }
  }
  return listeners;
}

export function parseSsListeners(stdout: string): PortListener[] {
  const listeners: PortListener[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    const stateIndex = cols[0] === "tcp" ? 1 : 0;
    if (cols[stateIndex] !== "LISTEN") continue;
    const parsed = endpoint(cols[stateIndex + 3] ?? "");
    if (!parsed) continue;
    const owners = [...line.matchAll(/\("([^"\n]*)",pid=([^,\s)]+)/g)];
    if (owners.length === 0) listeners.push(parsed);
    for (const owner of owners) {
      listeners.push({
        ...parsed,
        pid: positivePid(owner[2]!),
        command: owner[1],
      });
    }
  }
  return listeners;
}

function overlaps(listener: string, host: string): boolean {
  if (listener === host || listener === "*" || host === "*") return true;
  // :: 可能覆盖 IPv4；候选有歧义时由唯一 PID 判断阻止误选。
  if (listener === "::" || host === "::") return true;
  if (listener === "0.0.0.0") return isIP(host) === 4;
  if (host === "0.0.0.0") return isIP(listener) === 4;
  return false;
}

export function selectPortListeners(
  listeners: PortListener[],
  port: number,
  host: string,
): PortListener[] {
  const address = normalizeAddress(host);
  return address
    ? listeners.filter(
        (item) => item.port === port && overlaps(item.address, address),
      )
    : [];
}

export function uniquePortOwner(
  listeners: PortListener[],
): Pick<PortListener, "pid" | "command"> {
  const pids = new Set(listeners.map((item) => item.pid));
  if (pids.size !== 1 || pids.has(undefined)) return {};
  return { pid: listeners[0]?.pid, command: listeners[0]?.command };
}

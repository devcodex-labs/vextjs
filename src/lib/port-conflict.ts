import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PortConflictStrategy = "error" | "prompt" | "kill" | "next";
export type PortConflictDecision = "retry" | "kill" | "next" | "abort";

export interface PortConflictDetails {
  occupied: boolean;
  pid?: number;
  command?: string;
  source?: string;
}

export interface PortConflictRequest {
  host?: string;
  port: number;
  details: PortConflictDetails;
}

export interface ResolvePortConflictOptions {
  host?: string;
  port: number;
  strategy: PortConflictStrategy;
  interactive?: boolean;
  requestDecision?: (
    request: PortConflictRequest,
  ) => Promise<PortConflictDecision>;
}

export interface PortConflictResolution {
  port: number;
  changed: boolean;
  action: "none" | "next" | "kill";
  details?: PortConflictDetails;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizePortConflictStrategy(
  value: string | undefined,
): PortConflictStrategy {
  return value === "prompt" || value === "kill" || value === "next"
    ? value
    : "error";
}

export async function isPortOccupied(
  port: number,
  host?: string,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        resolve(true);
        return;
      }
      reject(error);
    });

    server.once("listening", () => {
      server.close(() => resolve(false));
    });

    server.listen({ port, host, exclusive: true });
  });
}

async function inspectPortConflictUnix(
  port: number,
): Promise<PortConflictDetails> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"]);
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const dataLine = lines[1];
    if (dataLine) {
      const cols = dataLine.split(/\s+/);
      const pid = Number(cols[1]);
      return {
        occupied: true,
        command: cols[0],
        pid: Number.isInteger(pid) ? pid : undefined,
        source: "lsof",
      };
    }
  } catch {
    // ignore
  }

  try {
    const { stdout } = await execFileAsync("ss", ["-ltnp"]);
    const line = stdout
      .split(/\r?\n/)
      .find((item) => item.includes(`:${port}`) && item.includes("LISTEN"));
    if (line) {
      const pidMatch = line.match(/pid=(\d+)/);
      const commandMatch = line.match(/users:\(\(([^,"]+)/);
      return {
        occupied: true,
        pid: pidMatch ? Number(pidMatch[1]) : undefined,
        command: commandMatch?.[1],
        source: "ss",
      };
    }
  } catch {
    // ignore
  }

  return { occupied: true };
}

async function inspectPortConflictWindows(
  port: number,
): Promise<PortConflictDetails> {
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano"]);
    const line = stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find(
        (item) =>
          item.startsWith("TCP") &&
          item.includes(`:${port}`) &&
          item.toUpperCase().includes("LISTENING"),
      );

    if (!line) {
      return { occupied: true, source: "netstat" };
    }

    const cols = line.split(/\s+/);
    const pid = Number(cols[4]);
    return {
      occupied: true,
      pid: Number.isInteger(pid) ? pid : undefined,
      source: "netstat",
    };
  } catch {
    return { occupied: true };
  }
}

export async function inspectPortConflict(
  port: number,
  _host?: string,
): Promise<PortConflictDetails> {
  if (process.platform === "win32") {
    return inspectPortConflictWindows(port);
  }
  return inspectPortConflictUnix(port);
}

async function waitUntilPortFree(
  port: number,
  host?: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isPortOccupied(port, host))) {
      return true;
    }
    await delay(200);
  }
  return !(await isPortOccupied(port, host));
}

export async function killPortOccupant(
  port: number,
  host?: string,
): Promise<PortConflictDetails> {
  const details = await inspectPortConflict(port, host);
  if (!details.pid) {
    throw new Error(
      `[vextjs] Port ${port} is occupied, but the owning process PID could not be determined.`,
    );
  }

  try {
    process.kill(details.pid, "SIGTERM");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[vextjs] Failed to stop process ${details.pid} on port ${port}: ${reason}`,
    );
  }

  const released = await waitUntilPortFree(port, host);
  if (!released) {
    throw new Error(
      `[vextjs] Process ${details.pid} did not release port ${port} in time.`,
    );
  }

  return details;
}

export async function findNextAvailablePort(
  startPort: number,
  host?: string,
  maxAttempts = 50,
): Promise<number> {
  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidate = startPort + offset;
    if (!(await isPortOccupied(candidate, host))) {
      return candidate;
    }
  }

  throw new Error(
    `[vextjs] Failed to find an available port after ${maxAttempts} attempts from ${startPort}.`,
  );
}

async function resolvePromptDecision(
  options: ResolvePortConflictOptions,
  details: PortConflictDetails,
): Promise<PortConflictResolution> {
  if (!options.interactive || !options.requestDecision) {
    throw new Error(
      `[vextjs] Port ${options.port} is already in use and prompt mode requires an interactive TTY parent process.`,
    );
  }

  while (true) {
    const decision = await options.requestDecision({
      host: options.host,
      port: options.port,
      details,
    });

    if (decision === "abort") {
      throw new Error(`[vextjs] Startup aborted because port ${options.port} is in use.`);
    }

    if (decision === "next") {
      const nextPort = await findNextAvailablePort(options.port + 1, options.host);
      return { port: nextPort, changed: true, action: "next", details };
    }

    if (decision === "kill") {
      const killed = await killPortOccupant(options.port, options.host);
      return { port: options.port, changed: false, action: "kill", details: killed };
    }

    const free = !(await isPortOccupied(options.port, options.host));
    if (free) {
      return { port: options.port, changed: false, action: "none", details };
    }

    await delay(200);
  }
}

export async function resolvePortConflict(
  options: ResolvePortConflictOptions,
): Promise<PortConflictResolution> {
  const occupied = await isPortOccupied(options.port, options.host);
  if (!occupied) {
    return { port: options.port, changed: false, action: "none" };
  }

  const details = await inspectPortConflict(options.port, options.host);

  switch (options.strategy) {
    case "next": {
      const nextPort = await findNextAvailablePort(options.port + 1, options.host);
      return { port: nextPort, changed: true, action: "next", details };
    }
    case "kill": {
      const killed = await killPortOccupant(options.port, options.host);
      return { port: options.port, changed: false, action: "kill", details: killed };
    }
    case "prompt":
      return resolvePromptDecision(options, details);
    case "error":
    default:
      throw new Error(
        `[vextjs] Port ${options.port} is already in use.` +
          (details.pid ? ` (pid: ${details.pid})` : ""),
      );
  }
}


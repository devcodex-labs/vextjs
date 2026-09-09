import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findNextAvailablePort,
  inspectPortConflict,
  killPortOccupant,
  resolvePortConflict,
} from "../../src/lib/port-conflict.js";

const { runCommand, resolveHost } = vi.hoisted(() => ({
  runCommand: vi.fn(),
  resolveHost: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: runCommand,
  }),
}));
vi.mock("node:dns/promises", () => ({ lookup: resolveHost }));

const platformDescriptor = Object.getOwnPropertyDescriptor(
  process,
  "platform",
)!;
const servers: Server[] = [];

function platform(value: string): void {
  Object.defineProperty(process, "platform", { value, configurable: true });
}

function netstat(lines: string): void {
  runCommand.mockResolvedValue({ stdout: lines, stderr: "" });
}

async function listen(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No TCP address");
  return { server, port: address.port };
}

beforeEach(() => {
  platform("win32");
  runCommand.mockReset();
  resolveHost.mockReset();
  // Even a regressing kill branch must never signal a real process.
  vi.spyOn(process, "kill").mockImplementation(() => {
    throw new Error("Unexpected process termination");
  });
});

afterEach(async () => {
  Object.defineProperty(process, "platform", platformDescriptor);
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe("port conflict ownership", () => {
  it("matches the complete local endpoint and listening state", async () => {
    netstat(
      [
        "TCP 127.0.0.1:30001 0.0.0.0:0 LISTENING 101",
        "TCP 127.0.0.1:9000 127.0.0.1:3000 LISTENING 102",
        "TCP 127.0.0.2:3000 0.0.0.0:0 LISTENING 103",
        "TCP 127.0.0.1:3000 0.0.0.0:0 ESTABLISHED 104",
        "TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 105",
      ].join("\n"),
    );
    expect(await inspectPortConflict(3000, "127.0.0.1")).toMatchObject({
      pid: 105,
      source: "netstat",
    });
  });

  it.each([
    ["::1", "[0:0:0:0:0:0:0:1]:3000"],
    ["127.0.0.1", "[::ffff:127.0.0.1]:3000"],
    ["127.0.0.1", "0.0.0.0:3000"],
    ["127.0.0.1", "[::]:3000"],
  ])(
    "matches equivalent or wildcard listener %s / %s",
    async (host, endpoint) => {
      netstat(
        `TCP 192.0.2.1:3000 0.0.0.0:0 LISTENING 101\nTCP ${endpoint} [::]:0 LISTENING 105`,
      );
      expect((await inspectPortConflict(3000, host)).pid).toBe(105);
    },
  );

  it("resolves the requested hostname without selecting a different address", async () => {
    resolveHost.mockResolvedValue({ address: "127.0.0.2", family: 4 });
    netstat(
      "TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 101\nTCP 127.0.0.2:3000 0.0.0.0:0 LISTENING 105",
    );
    expect((await inspectPortConflict(3000, "service.local")).pid).toBe(105);
    expect(resolveHost).toHaveBeenCalledWith("service.local");
  });

  it.each(["0", "-2", "bad", "9007199254740993"])(
    "does not expose invalid PID %s",
    async (pid) => {
      netstat(`TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING ${pid}`);
      expect(
        (await inspectPortConflict(3000, "127.0.0.1")).pid,
      ).toBeUndefined();
    },
  );

  it("does not choose among multiple or partially hidden owners", async () => {
    for (const secondPid of ["106", "0"]) {
      netstat(
        `TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING 105\nTCP 0.0.0.0:3000 0.0.0.0:0 LISTENING ${secondPid}`,
      );
      expect(
        (await inspectPortConflict(3000, "127.0.0.1")).pid,
      ).toBeUndefined();
      await expect(killPortOccupant(3000, "127.0.0.1")).rejects.toThrow(
        "could not be determined",
      );
    }
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("deduplicates multiple sockets owned by the same PID", async () => {
    netstat(
      "TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 105\nTCP [::]:3000 [::]:0 LISTENING 105",
    );
    expect((await inspectPortConflict(3000)).pid).toBe(105);
  });

  it("leaves PID unknown when hostname resolution or inspection fails", async () => {
    resolveHost.mockRejectedValue(new Error("DNS unavailable"));
    netstat("TCP 0.0.0.0:3000 0.0.0.0:0 LISTENING 105");
    expect(
      (await inspectPortConflict(3000, "service.local")).pid,
    ).toBeUndefined();
    runCommand.mockRejectedValue(new Error("command unavailable"));
    expect(await inspectPortConflict(3000)).toEqual({ occupied: true });
  });

  it("parses lsof field output by process and exact endpoint", async () => {
    platform("darwin");
    runCommand.mockResolvedValue({
      stdout:
        "p101\ncother\nf1\nn127.0.0.2:3000\np105\ncnode app\nf2\nn[::1]:3000\nf3\nn[::1]:3000\n",
    });
    expect(await inspectPortConflict(3000, "::1")).toMatchObject({
      pid: 105,
      command: "node app",
      source: "lsof",
    });
    expect(runCommand.mock.calls[0]?.[1]).toContain("-Fpcn");
  });

  it("parses ss local endpoints and all owners after lsof is unavailable", async () => {
    platform("linux");
    runCommand
      .mockRejectedValueOnce(new Error("lsof not installed"))
      .mockResolvedValue({
        stdout: [
          'LISTEN 0 128 127.0.0.1:30001 0.0.0.0:* users:(("wrong",pid=101,fd=1))',
          'LISTEN 0 128 127.0.0.1:9000 127.0.0.1:3000 users:(("wrong",pid=102,fd=1))',
          'LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=105,fd=2))',
        ].join("\n"),
      });
    expect(await inspectPortConflict(3000, "127.0.0.1")).toMatchObject({
      pid: 105,
      command: "node",
      source: "ss",
    });
    runCommand
      .mockRejectedValueOnce(new Error("lsof not installed"))
      .mockResolvedValue({
        stdout:
          'tcp LISTEN 0 128 *:3000 *:* users:(("node",pid=105,fd=2),("node",pid=106,fd=2))',
      });
    expect((await inspectPortConflict(3000)).pid).toBeUndefined();
  });

  it("refuses to terminate the current process", async () => {
    netstat(`TCP 127.0.0.1:3000 0.0.0.0:0 LISTENING ${process.pid}`);
    await expect(killPortOccupant(3000, "127.0.0.1")).rejects.toThrow(
      "current process",
    );
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("does not kill a replacement owner after a prompt", async () => {
    const { port } = await listen();
    netstat(`TCP 127.0.0.1:${port} 0.0.0.0:0 LISTENING 105`);
    await expect(
      resolvePortConflict({
        host: "127.0.0.1",
        port,
        strategy: "prompt",
        interactive: true,
        requestDecision: async (request) => {
          expect(request.details.pid).toBe(105);
          netstat(`TCP 127.0.0.1:${port} 0.0.0.0:0 LISTENING 106`);
          return "kill";
        },
      }),
    ).rejects.toThrow("owning process changed");
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("signals the verified owner and confirms that the test port is released", async () => {
    const { server, port } = await listen();
    netstat(`TCP 127.0.0.1:${port} 0.0.0.0:0 LISTENING 105`);
    vi.mocked(process.kill).mockImplementation(() => {
      server.close();
      return true;
    });
    expect(
      (await resolvePortConflict({ host: "127.0.0.1", port, strategy: "kill" }))
        .action,
    ).toBe("kill");
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(105, "SIGTERM");
    expect(server.listening).toBe(false);
  });

  it("reports exhaustion without probing an out of range port", async () => {
    await expect(findNextAvailablePort(65536, "127.0.0.1")).rejects.toThrow(
      "Failed to find an available port",
    );
  });
});

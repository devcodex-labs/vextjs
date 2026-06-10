import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => {
  const createInterface = vi.fn();
  const detectProject = vi.fn();
  const inspectDistBuild = vi.fn();
  const resolveEntryFile = vi.fn();
  const resolvePreloads = vi.fn();
  const runDevPreflight = vi.fn();
  const shouldUsePolling = vi.fn();
  const classifyChange = vi.fn(() => ({ action: "soft" }));
  const fork = vi.fn();

  const restarterInstances: MockColdRestarter[] = [];
  const watcherInstances: MockWatcher[] = [];

  class MockColdRestarter {
    options: Record<string, unknown>;
    events: {
      onChildMessage?: (msg: unknown) => void;
      onChildExit?: (code: number | null, signal: string | null) => void;
    } = {};
    restart = vi.fn(async () => undefined);
    sendToChild = vi.fn();
    kill = vi.fn(async () => undefined);
    setExtraExecArgv = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      restarterInstances.push(this);
    }

    setEvents(events: typeof this.events): void {
      this.events = events;
    }
  }

  class MockWatcher {
    options: Record<string, unknown>;
    handlers = new Map<string, (...args: unknown[]) => void>();
    start = vi.fn(async () => undefined);
    stop = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      watcherInstances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void): this {
      this.handlers.set(event, handler);
      return this;
    }
  }

  return {
    createInterface,
    detectProject,
    inspectDistBuild,
    resolveEntryFile,
    resolvePreloads,
    runDevPreflight,
    shouldUsePolling,
    classifyChange,
    fork,
    MockColdRestarter,
    MockWatcher,
    restarterInstances,
    watcherInstances,
  };
});

vi.mock("node:child_process", () => ({
  fork: mocks.fork,
}));

vi.mock("node:readline/promises", () => ({
  createInterface: mocks.createInterface,
}));

vi.mock("../../../src/cli/utils/detect-project.js", () => ({
  detectProject: mocks.detectProject,
  inspectDistBuild: mocks.inspectDistBuild,
  resolveEntryFile: mocks.resolveEntryFile,
}));

vi.mock("../../../src/cli/utils/preload.js", () => ({
  resolvePreloads: mocks.resolvePreloads,
}));

vi.mock("../../../src/cli/utils/dev-preflight.js", () => ({
  runDevPreflight: mocks.runDevPreflight,
}));

vi.mock("../../../src/lib/dev/cold-restarter.js", () => ({
  ColdRestarter: mocks.MockColdRestarter,
}));

vi.mock("../../../src/lib/dev/file-watcher.js", () => ({
  VextFileWatcher: mocks.MockWatcher,
}));

vi.mock("../../../src/lib/dev/change-classifier.js", () => ({
  classifyChange: mocks.classifyChange,
}));

vi.mock("../../../src/lib/dev/detect-polling.js", () => ({
  shouldUsePolling: mocks.shouldUsePolling,
}));

import { startCommand } from "../../../src/cli/start.js";
import { devCommand } from "../../../src/cli/dev.js";

interface MockReadline {
  question: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function createMockChild() {
  const child = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    connected: boolean;
    killed: boolean;
  };

  child.send = vi.fn();
  child.kill = vi.fn(() => true);
  child.connected = true;
  child.killed = false;
  return child;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value,
    configurable: true,
  });
}

describe("cli interaction: start/dev", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleClearSpy: ReturnType<typeof vi.spyOn>;
  let stdinSetRawModeSpy: any;
  let stdinResumeSpy: any;
  let stdinSetEncodingSpy: any;
  let processOnSpy: any;
  let processOnceSpy: any;
  let processExitSpy: any;
  let originalStdinTTY: boolean | undefined;
  let originalStdoutTTY: boolean | undefined;
  let originalSetRawMode: ((mode: boolean) => NodeJS.ReadStream) | undefined;
  let readline: MockReadline;
  let tempDirs: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.restarterInstances.length = 0;
    mocks.watcherInstances.length = 0;
    tempDirs = [];

    originalStdinTTY = process.stdin.isTTY;
    originalStdoutTTY = process.stdout.isTTY;
    originalSetRawMode = (process.stdin as NodeJS.ReadStream).setRawMode;
    setTTY(true);

    Object.defineProperty(process.stdin, "setRawMode", {
      value:
        originalSetRawMode ?? vi.fn(() => process.stdin as NodeJS.ReadStream),
      configurable: true,
      writable: true,
    });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleClearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});

    stdinSetRawModeSpy = vi
      .spyOn(process.stdin as NodeJS.ReadStream, "setRawMode")
      .mockImplementation(() => process.stdin as NodeJS.ReadStream);
    stdinResumeSpy = vi
      .spyOn(process.stdin, "resume")
      .mockImplementation(() => process.stdin);
    stdinSetEncodingSpy = vi
      .spyOn(process.stdin, "setEncoding")
      .mockImplementation(() => process.stdin);

    processOnSpy = vi.spyOn(process, "on");
    processOnceSpy = vi.spyOn(process, "once");
    processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as never);

    mocks.detectProject.mockReturnValue({
      rootDir: "E:/Worker/vext-fixture",
      srcDir: "E:/Worker/vext-fixture/src",
      language: "ts",
    });
    mocks.inspectDistBuild.mockReturnValue({
      valid: true,
      hasDistDir: true,
      missing: [],
    });
    mocks.resolveEntryFile.mockReturnValue(
      "E:/Worker/vext-fixture/node_modules/vextjs/dist/lib/bootstrap.js",
    );
    mocks.resolvePreloads.mockResolvedValue([]);
    mocks.runDevPreflight.mockResolvedValue({
      ok: true,
      typegenOk: true,
      tsOk: true,
    });
    mocks.shouldUsePolling.mockReturnValue(false);

    readline = {
      question: vi.fn().mockResolvedValue("n"),
      close: vi.fn(),
    };
    mocks.createInterface.mockReturnValue(readline);
  });

  afterEach(() => {
    process.stdin.removeAllListeners("data");
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    if (originalStdinTTY !== undefined) {
      setTTY(originalStdinTTY);
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalStdoutTTY,
        configurable: true,
      });
    }
    Object.defineProperty(process.stdin, "setRawMode", {
      value: originalSetRawMode,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempProfilePath(): string {
    const dir = mkdtempSync(join(tmpdir(), "vext-startup-profile-"));
    tempDirs.push(dir);
    return join(dir, "startup-profile.json");
  }

  function createProfile() {
    return {
      enabled: true,
      startedAt: "2026-06-10T00:00:00.000Z",
      startedAtMs: Date.now(),
      elapsedMs: 25,
      events: [
        {
          name: "worker.compile",
          startMs: 1,
          durationMs: 10,
          phase: "compile",
          kind: "event" as const,
        },
      ],
    };
  }

  it("startCommand should prompt on port conflict and send the chosen action back to child", async () => {
    const child = createMockChild();
    mocks.fork.mockReturnValue(child);
    readline.question.mockResolvedValue("k");

    await startCommand(["--port-conflict", "prompt"]);
    child.emit("message", {
      type: "port-conflict",
      host: "127.0.0.1",
      port: 3200,
      details: { pid: 1234, command: "node app.js" },
    });
    await flush();

    expect(mocks.fork).toHaveBeenCalledTimes(1);
    expect(readline.question).toHaveBeenCalledWith(
      expect.stringContaining("Choose: [r]etry / [k]ill / [n]ext / [a]bort"),
    );
    expect(child.send).toHaveBeenCalledWith({
      type: "port-conflict-decision",
      action: "kill",
    });
    expect(readline.close).toHaveBeenCalledTimes(1);
    expect(processOnceSpy).toHaveBeenCalledWith(
      "SIGTERM",
      expect.any(Function),
    );
    expect(processOnceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
  });

  it("startCommand should fail fast for TypeScript projects without a valid dist build", async () => {
    mocks.inspectDistBuild.mockReturnValueOnce({
      valid: false,
      hasDistDir: true,
      missing: ["dist/config/default.js"],
    });

    await expect(startCommand([])).rejects.toThrow("process.exit");

    expect(mocks.fork).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Cannot run TypeScript project with vext start"),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Run "vext build" first'),
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("startCommand should allow JavaScript projects without a dist build", async () => {
    const child = createMockChild();
    mocks.fork.mockReturnValue(child);
    mocks.detectProject.mockReturnValueOnce({
      rootDir: "E:/Worker/vext-js-fixture",
      srcDir: "E:/Worker/vext-js-fixture/src",
      language: "js",
    });
    mocks.inspectDistBuild.mockReturnValueOnce({
      valid: false,
      hasDistDir: false,
      missing: [],
    });

    await startCommand([]);

    expect(mocks.fork).toHaveBeenCalledTimes(1);
    expect(mocks.fork).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ execArgv: [] }),
    );
  });

  it("startCommand should pass startup profile env and print ready totals from child payload", async () => {
    const child = createMockChild();
    mocks.fork.mockReturnValue(child);

    await startCommand(["--startup-profile", "--port", "3302"]);
    child.emit("message", {
      type: "ready",
      server: { host: "127.0.0.1", port: 3302 },
      startupProfile: {
        ...createProfile(),
        events: [
          {
            name: "start.routes",
            startMs: 1,
            durationMs: 10,
            kind: "event" as const,
          },
        ],
      },
    });
    await flush();

    const forkOptions = mocks.fork.mock.calls[0]?.[2] as
      | { env?: Record<string, string> }
      | undefined;
    expect(forkOptions?.env).toMatchObject({
      VEXT_START_PARENT_READY_LOG: "1",
      VEXT_START_STARTUP_PROFILE: "1",
      VEXT_START_STARTUP_PROFILE_HUMAN: "1",
      VEXT_PORT: "3302",
    });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[vextjs] ready on http://127.0.0.1:3302"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("total="),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[vextjs] startup summary"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[vextjs] startup profile details"),
    );
  });

  it("startCommand should keep JSON-only profile human-readable output disabled", async () => {
    const child = createMockChild();
    mocks.fork.mockReturnValue(child);
    const profilePath = createTempProfilePath();

    await startCommand(["--startup-profile-json", profilePath]);
    child.emit("message", {
      type: "ready",
      server: { host: "127.0.0.1", port: 3303 },
      startupProfile: createProfile(),
    });
    await flush();

    const forkOptions = mocks.fork.mock.calls[0]?.[2] as
      | { env?: Record<string, string> }
      | undefined;
    expect(forkOptions?.env).toMatchObject({
      VEXT_START_PARENT_READY_LOG: "1",
      VEXT_START_STARTUP_PROFILE: "1",
      VEXT_STARTUP_PROFILE_JSON: profilePath,
    });
    expect(forkOptions?.env?.VEXT_START_STARTUP_PROFILE_HUMAN).toBeUndefined();
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("startup summary"),
    );
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("startup profile details"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `[vextjs] startup profile json: ${profilePath}`,
    );
  });

  it("startCommand should abort automatically when stdio is not interactive", async () => {
    const child = createMockChild();
    mocks.fork.mockReturnValue(child);
    setTTY(false);

    await startCommand(["--port-conflict", "prompt"]);
    child.emit("message", {
      type: "port-conflict",
      port: 3201,
    });
    await flush();

    expect(mocks.createInterface).not.toHaveBeenCalled();
    expect(child.send).toHaveBeenCalledWith({
      type: "port-conflict-decision",
      action: "abort",
    });
  });

  it("devCommand should pause raw mode for the prompt and restore it before replying", async () => {
    readline.question.mockResolvedValue("retry");

    await devCommand([]);
    const restarter = mocks.restarterInstances[0]!;

    restarter.events.onChildMessage?.({
      type: "port-conflict",
      host: "127.0.0.1",
      port: 3300,
      details: { pid: 2233, command: "node dev.js" },
    });
    await flush();

    expect(stdinSetRawModeSpy).toHaveBeenCalledWith(true);
    expect(stdinSetRawModeSpy).toHaveBeenCalledWith(false);
    expect(readline.question).toHaveBeenCalledWith(
      expect.stringContaining("[vext dev] Port 127.0.0.1:3300 is in use"),
    );
    expect(restarter.sendToChild).toHaveBeenCalledWith({
      type: "port-conflict-decision",
      action: "retry",
    });
  });

  it("devCommand should suppress keyboard shortcuts while the port-conflict prompt is active", async () => {
    let resolveQuestion: ((value: string) => void) | undefined;
    readline.question.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveQuestion = resolve;
        }),
    );

    await devCommand([]);
    const restarter = mocks.restarterInstances[0]!;

    restarter.events.onChildMessage?.({
      type: "port-conflict",
      host: "127.0.0.1",
      port: 3301,
    });
    await flush();

    process.stdin.emit("data", "r");
    process.stdin.emit("data", "h");
    process.stdin.emit("data", "?");
    await flush();

    expect(restarter.restart).toHaveBeenCalledTimes(1);
    expect(restarter.sendToChild).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "reload" }),
    );
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("manual cold restart"),
    );

    resolveQuestion?.("a");
    await flush();

    expect(restarter.sendToChild).toHaveBeenCalledWith({
      type: "port-conflict-decision",
      action: "abort",
    });
    expect(consoleClearSpy).not.toHaveBeenCalled();
    expect(processOnSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(processOnSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  it("devCommand should skip initial start when preflight fails", async () => {
    mocks.runDevPreflight.mockResolvedValueOnce({
      ok: false,
      typegenOk: true,
      tsOk: false,
    });

    await devCommand([]);

    const restarter = mocks.restarterInstances[0]!;
    expect(restarter.restart).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("initial checks failed"),
    );
  });

  it("devCommand should request async TypeScript diagnostics by default", async () => {
    await devCommand([]);

    const restarter = mocks.restarterInstances[0]!;
    expect(restarter.options.env).toMatchObject({
      VEXT_DEV_PARENT_READY_LOG: "1",
    });
    expect(
      (restarter.options.env as Record<string, string>)
        .VEXT_DEV_STARTUP_PROFILE,
    ).toBeUndefined();
    expect(mocks.runDevPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "initial start",
        tsDiagnosticsMode: "async",
        logTypegenDetails: false,
      }),
    );
  });

  it("devCommand should request blocking TypeScript diagnostics in strict preflight mode", async () => {
    await devCommand(["--strict-preflight"]);

    expect(mocks.runDevPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "initial start",
        tsDiagnosticsMode: "blocking",
      }),
    );
  });

  it("devCommand should print ready total and profile details only in human profile mode", async () => {
    await devCommand(["--startup-profile"]);
    const restarter = mocks.restarterInstances[0]!;

    expect(restarter.options.env).toMatchObject({
      VEXT_DEV_PARENT_READY_LOG: "1",
      VEXT_DEV_STARTUP_PROFILE: "1",
      VEXT_DEV_STARTUP_PROFILE_HUMAN: "1",
    });
    expect(mocks.runDevPreflight).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "initial start",
        logTypegenDetails: true,
      }),
    );

    restarter.events.onChildMessage?.({
      type: "ready",
      server: { host: "127.0.0.1", port: 3304 },
      startupProfile: createProfile(),
    });
    await flush();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[vext dev] ready on http://127.0.0.1:3304"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("soft reload enabled"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[vext dev] startup summary"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[vext dev] startup profile details"),
    );
  });

  it("devCommand should write JSON-only profile without printing summary or details", async () => {
    const profilePath = createTempProfilePath();

    await devCommand(["--startup-profile-json", profilePath]);
    const restarter = mocks.restarterInstances[0]!;

    expect(restarter.options.env).toMatchObject({
      VEXT_DEV_PARENT_READY_LOG: "1",
      VEXT_DEV_STARTUP_PROFILE: "1",
      VEXT_STARTUP_PROFILE_JSON: profilePath,
    });
    expect(
      (restarter.options.env as Record<string, string>)
        .VEXT_DEV_STARTUP_PROFILE_HUMAN,
    ).toBeUndefined();

    restarter.events.onChildMessage?.({
      type: "ready",
      server: { host: "127.0.0.1", port: 3305 },
      startupProfile: createProfile(),
    });
    await flush();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("[vext dev] ready on http://127.0.0.1:3305"),
    );
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("startup summary"),
    );
    expect(consoleLogSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("startup profile details"),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      `[vext dev] startup profile json: ${profilePath}`,
    );
  });

  it("devCommand should skip reload when preflight fails on file change", async () => {
    mocks.runDevPreflight
      .mockResolvedValueOnce({
        ok: true,
        typegenOk: true,
        tsOk: true,
      })
      .mockResolvedValueOnce({
        ok: false,
        typegenOk: false,
        tsOk: true,
      });

    await devCommand([]);
    const watcher = mocks.watcherInstances[0]!;
    const restarter = mocks.restarterInstances[0]!;

    await watcher.handlers.get("change")?.({
      files: [{ path: "src/services/example.ts", type: "modify" }],
      action: "soft",
    });

    expect(restarter.sendToChild).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "reload" }),
    );
  });
});

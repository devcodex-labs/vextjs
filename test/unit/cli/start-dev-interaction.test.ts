import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => {
  const createInterface = vi.fn();
  const detectProject = vi.fn();
  const hasDistBuild = vi.fn();
  const resolveEntryFile = vi.fn();
  const resolvePreloads = vi.fn();
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

    constructor(options: Record<string, unknown>) {
      this.options = options;
      restarterInstances.push(this);
    }

    setEvents(
      events: typeof this.events,
    ): void {
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
    hasDistBuild,
    resolveEntryFile,
    resolvePreloads,
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
  hasDistBuild: mocks.hasDistBuild,
  resolveEntryFile: mocks.resolveEntryFile,
}));

vi.mock("../../../src/cli/utils/preload.js", () => ({
  resolvePreloads: mocks.resolvePreloads,
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
  let originalStdinTTY: boolean | undefined;
  let originalStdoutTTY: boolean | undefined;
  let originalSetRawMode:
    | ((mode: boolean) => NodeJS.ReadStream)
    | undefined;
  let readline: MockReadline;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.restarterInstances.length = 0;
    mocks.watcherInstances.length = 0;

    originalStdinTTY = process.stdin.isTTY;
    originalStdoutTTY = process.stdout.isTTY;
    originalSetRawMode = (process.stdin as NodeJS.ReadStream).setRawMode;
    setTTY(true);

    Object.defineProperty(process.stdin, "setRawMode", {
      value: originalSetRawMode ?? vi.fn(() => process.stdin as NodeJS.ReadStream),
      configurable: true,
      writable: true,
    });

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleClearSpy = vi.spyOn(console, "clear").mockImplementation(() => {});

    stdinSetRawModeSpy = vi
      .spyOn(process.stdin as NodeJS.ReadStream, "setRawMode")
      .mockImplementation(() => process.stdin as NodeJS.ReadStream);
    stdinResumeSpy = vi.spyOn(process.stdin, "resume").mockImplementation(() => process.stdin);
    stdinSetEncodingSpy = vi
      .spyOn(process.stdin, "setEncoding")
      .mockImplementation(() => process.stdin);

    processOnSpy = vi.spyOn(process, "on");
    processOnceSpy = vi.spyOn(process, "once");

    mocks.detectProject.mockReturnValue({
      rootDir: "E:/Worker/vext-fixture",
      srcDir: "E:/Worker/vext-fixture/src",
      language: "ts",
    });
    mocks.hasDistBuild.mockReturnValue(false);
    mocks.resolveEntryFile.mockReturnValue("E:/Worker/vext-fixture/node_modules/vextjs/dist/lib/bootstrap.js");
    mocks.resolvePreloads.mockReturnValue([]);
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
  });

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
    expect(processOnceSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(processOnceSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
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
});


import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import process from "node:process";

export function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function findAvailablePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate a TCP port")));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function captureTail(chunks, maximumCharacters = 8_000) {
  const output = chunks.join("");
  return output.length <= maximumCharacters
    ? output
    : `…${output.slice(-maximumCharacters)}`;
}

function appendTail(chunks, chunk, maximumCharacters = 8_000) {
  const next = captureTail([...chunks, chunk], maximumCharacters);
  chunks.splice(0, chunks.length, next);
}

function startupDiagnostics(stdout, stderr) {
  const standardOutput = captureTail(stdout);
  const standardError = captureTail(stderr);
  if (!standardOutput && !standardError) return "(no child output captured)";
  return [
    standardOutput && `stdout:\n${standardOutput}`,
    standardError && `stderr:\n${standardError}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit").catch(() => undefined);
  await Promise.race([exit, sleep(timeoutMs)]);
}

async function terminateOwnedChild(child, timeoutMs = 8_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (!child.killed) child.kill("SIGTERM");
  await waitForChildExit(child, timeoutMs);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForChildExit(child, 2_000);
  }
}

export async function startOwnedProcess({
  entry,
  label,
  cwd,
  env = {},
  onStdout,
  onStderr,
  onMessage,
  autoStart = true,
  readyTimeoutMs = 20_000,
  outputTailCharacters = 8_000,
  discardStdout = false,
}) {
  const child = fork(entry, [], {
    cwd,
    env: { ...process.env, ...env },
    silent: true,
    // Benchmark children must execute only their declared entrypoint. In
    // particular, inheriting a parent `--eval` would recursively execute the
    // harness rather than the target module.
    execArgv: [],
  });
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => {
    if (discardStdout) return;
    const text = String(chunk);
    appendTail(stdout, text, outputTailCharacters);
    onStdout?.(text);
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk);
    appendTail(stderr, text, outputTailCharacters);
    onStderr?.(text);
  });

  let settled = false;
  let timer;
  let awaitingStartMessage;
  let resolveAwaitingStart;
  let rejectAwaitingStart;
  let resolveReady;
  let rejectReady;
  let startPromise;
  const awaitingStart = new Promise((resolve, reject) => {
    resolveAwaitingStart = resolve;
    rejectAwaitingStart = reject;
  });
  const rejectStartup = (error) => {
    if (!settled) {
      settled = true;
      clearTimeout(timer);
      rejectReady(error);
    }
    if (!awaitingStartMessage) rejectAwaitingStart(error);
  };
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
    timer = setTimeout(() => {
      rejectStartup(
        new Error(`${label} did not report ready within ${readyTimeoutMs} ms`),
      );
    }, readyTimeoutMs);
  });
  // `awaitingStart` is the caller's pre-start control-plane gate. Mark the
  // internal promise handled here so a startup failure before `start()` is
  // invoked is still reported through the returned helper rather than as an
  // unrelated unhandled rejection.
  void ready.catch(() => {});
  const sendStart = () => {
    if (startPromise) return startPromise;
    if (!awaitingStartMessage) {
      const error = new Error(`${label} has not reached awaiting-start`);
      rejectStartup(error);
      return Promise.reject(error);
    }
    if (
      child.exitCode !== null ||
      child.signalCode !== null ||
      !child.connected
    ) {
      const error = new Error(`${label} exited or disconnected before start`);
      rejectStartup(error);
      return Promise.reject(error);
    }
    try {
      child.send({ type: "start" });
    } catch (error) {
      rejectStartup(error);
      return Promise.reject(error);
    }
    startPromise = ready;
    return startPromise;
  };
  child.on("message", (message) => {
    onMessage?.(message);
    if (message?.type === "awaiting-start") {
      if (awaitingStartMessage) {
        rejectStartup(
          new Error(`${label} reported awaiting-start more than once`),
        );
        return;
      }
      if (Number(message.pid) !== Number(child.pid)) {
        rejectStartup(
          new Error(
            `${label} awaiting-start PID ${String(message.pid)} does not match child ${String(child.pid)}`,
          ),
        );
        return;
      }
      awaitingStartMessage = message;
      resolveAwaitingStart(message);
      if (autoStart) void sendStart().catch(() => {});
      return;
    }
    if (settled) return;
    if (message?.type === "ready") {
      if (!awaitingStartMessage) {
        rejectStartup(
          new Error(`${label} reported ready before awaiting-start`),
        );
      } else if (Number(message.pid) !== Number(child.pid)) {
        rejectStartup(
          new Error(
            `${label} ready PID ${String(message.pid)} does not match child ${String(child.pid)}`,
          ),
        );
      } else {
        settled = true;
        clearTimeout(timer);
        resolveReady(message);
      }
    } else if (message?.type === "error") {
      rejectStartup(new Error(`${label} startup failed: ${message.message}`));
    }
  });
  child.once("exit", (code, signal) => {
    rejectStartup(
      new Error(
        `${label} exited before ready (code=${String(code)}, signal=${String(signal)}): ${stderr.join("")}`,
      ),
    );
  });
  child.once("error", (error) => {
    rejectStartup(
      new Error(`${label} failed to start: ${error.message}`, { cause: error }),
    );
  });
  try {
    const awaitingMessage = await awaitingStart;
    const owned = {
      child,
      label,
      pid: child.pid,
      awaitingStart: { pid: Number(awaitingMessage.pid) },
      ready: null,
      stdout,
      stderr,
      start: async () => {
        const readyMessage = await sendStart();
        if (Number(readyMessage?.pid) !== Number(child.pid)) {
          throw new Error(
            `${label} ready PID ${String(readyMessage?.pid)} does not match child ${String(child.pid)}`,
          );
        }
        owned.ready = readyMessage;
        return readyMessage;
      },
    };
    if (autoStart) await owned.start();
    return owned;
  } catch (error) {
    await terminateOwnedChild(child);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${startupDiagnostics(stdout, stderr)}`,
      { cause: error },
    );
  }
}

export async function requestProcessMessage(
  owned,
  type,
  { timeoutMs = 5_000, payload = {} } = {},
) {
  const requestId = `${type}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const message = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`${owned.label} did not reply to ${type}`));
    }, timeoutMs);
    const onMessage = (candidate) => {
      if (candidate?.requestId !== requestId) return;
      cleanup();
      resolve(candidate);
    };
    const cleanup = () => {
      clearTimeout(timer);
      owned.child.off("message", onMessage);
    };
    owned.child.on("message", onMessage);
    owned.child.send({ type, requestId, ...payload });
  });
  return message;
}

export async function stopOwnedProcess(owned, { timeoutMs = 8_000 } = {}) {
  if (!owned?.child) return;
  const { child } = owned;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (child.connected) child.send({ type: "shutdown" });
    else child.kill("SIGTERM");
    await waitForChildExit(child, timeoutMs);
  } finally {
    await terminateOwnedChild(child, 2_000);
  }
}

export async function requestJson(url, request) {
  const method = request.method.toUpperCase();
  const canHaveBody = method !== "GET" && method !== "HEAD";
  const response = await fetch(url, {
    method,
    headers: request.headers,
    body:
      !canHaveBody || request.body === undefined
        ? undefined
        : typeof request.body === "string"
          ? request.body
          : JSON.stringify(request.body),
  });
  const rawBody = await response.text();
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    body = undefined;
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
    rawBody,
  };
}

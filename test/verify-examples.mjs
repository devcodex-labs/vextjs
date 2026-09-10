import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { resolveValidationCommand } from "../scripts/validation/resolve-command.mjs";

// Copy the authoritative examples into real installed consumers. Only their
// file: dependency points at the candidate; application source is unchanged.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tarball = path.resolve(
  process.argv[2] ?? process.env.VEXT_INSTALLED_TARBALL ?? "",
);
assert.ok(tarball.endsWith(".tgz"), "Pass the built candidate .tgz path");
const workspace = process.env.VEXT_EXAMPLES_WORKSPACE
  ? path.resolve(process.env.VEXT_EXAMPLES_WORKSPACE)
  : mkdtempSync(path.join(tmpdir(), "vext-examples-"));
mkdirSync(workspace, { recursive: true });
const records = [];
let database;
let databaseRecord;
let failure;

function start(args, cwd, env) {
  const invocation = resolveValidationCommand("npm", args);
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = {
    command: [invocation.command, ...invocation.args],
    cwd,
    pid: child.pid,
    stdout: "",
    stderr: "",
    exitCode: null,
  };
  records.push(record);
  child.stdout.on("data", (bytes) => {
    record.stdout = (record.stdout + bytes).slice(-100_000);
  });
  child.stderr.on("data", (bytes) => {
    record.stderr = (record.stderr + bytes).slice(-100_000);
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      record.exitCode = code;
      resolve(code);
    });
  });
  return { child, record, done };
}

async function stop(operation) {
  const { child } = operation;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    // This PID was spawned above. Terminate only its process tree, including
    // npm's application child; never select a process by an unrelated port.
    const killer = spawn(
      "taskkill.exe",
      ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, stdio: "ignore" },
    );
    await once(killer, "close");
  } else child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await operation.done;
  } finally {
    clearTimeout(timer);
  }
}

async function command(args, cwd, env) {
  const operation = start(args, cwd, env);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void stop(operation);
  }, 180_000);
  try {
    const code = await operation.done;
    assert.equal(timedOut, false, `Timed out: npm ${args.join(" ")}`);
    assert.equal(code, 0, JSON.stringify(operation.record));
  } finally {
    clearTimeout(timer);
    await stop(operation);
  }
}

async function portProbe(port = 0) {
  const listener = createServer();
  listener.listen(port, "127.0.0.1");
  await once(listener, "listening");
  const actual = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return actual;
}

async function ready(url, operation) {
  const end = Date.now() + 25_000;
  let last = "not listening";
  while (Date.now() < end) {
    if (operation.child.exitCode !== null)
      throw new Error(JSON.stringify(operation.record));
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
      last = `${response.status} ${await response.text()}`;
    } catch (error) {
      last = String(error);
    }
    await delay(50);
  }
  throw new Error(
    `Readiness failed: ${last}\n${JSON.stringify(operation.record)}`,
  );
}

try {
  database = await MongoMemoryServer.create({
    binary: {
      version: "8.2.6",
      downloadDir: path.join(root, ".cache/mongodb-binaries"),
    },
  });
  const databaseInfo = database.instanceInfo;
  const databaseProcess = databaseInfo?.instance.mongodProcess;
  databaseRecord = {
    command: databaseProcess?.spawnargs,
    cwd: process.cwd(),
    pid: databaseProcess?.pid,
    port: databaseInfo?.port,
    url: database.getUri("vext_example"),
    dbPath: databaseInfo?.dbPath,
    cleanup: "pending",
  };
  console.log(JSON.stringify({ phase: "database-start", ...databaseRecord }));
  for (const name of ["hello-world", "crud-api"]) {
    const cwd = path.join(workspace, name);
    cpSync(path.join(root, "examples", name), cwd, {
      recursive: true,
      filter: (file) =>
        !["node_modules", "dist", ".vext", "package-lock.json"].includes(
          path.basename(file),
        ),
    });
    const metadata = JSON.parse(
      readFileSync(path.join(cwd, "package.json"), "utf8"),
    );
    metadata.dependencies.vextjs = `file:${tarball.replaceAll("\\", "/")}`;
    writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify(metadata, null, 2),
    );
    const port = await portProbe();
    const env = {
      PORT: String(port),
      MONGODB_URI: database.getUri("vext_example"),
      NODE_ENV: "production",
    };
    await command(
      [
        "install",
        "--include=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      cwd,
      env,
    );
    for (const script of ["typecheck", "build", "test"])
      await command(["run", script], cwd, env);
    const operation = start(["start"], cwd, env);
    operation.record.url = `http://127.0.0.1:${port}`;
    console.log(
      JSON.stringify({
        phase: "start",
        example: name,
        cwd,
        pid: operation.child.pid,
        port,
      }),
    );
    try {
      const base = operation.record.url;
      assert.equal((await ready(`${base}/health`, operation)).status, 200);
      assert.equal((await fetch(`${base}/docs`)).status, 200);
      const spec = await (await fetch(`${base}/openapi.json`)).json();
      assert.ok(spec.paths);
      if (name === "crud-api") {
        const request = (pathname, method = "GET", body) =>
          fetch(base + pathname, {
            method,
            ...(body === undefined
              ? {}
              : {
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(body),
                }),
          });
        assert.equal((await request("/todos", "POST", {})).status, 422);
        const created = await request("/todos", "POST", {
          title: "Verified tutorial",
        });
        assert.equal(created.status, 201);
        const { data } = await created.json();
        assert.ok(data.id);
        assert.equal(
          (await (await request(`/todos/${data.id}`)).json()).data.title,
          "Verified tutorial",
        );
        assert.equal(
          (
            await (
              await request(`/todos/${data.id}`, "PATCH", { completed: true })
            ).json()
          ).data.completed,
          true,
        );
        assert.equal(
          (await (await request("/todos?limit=20")).json()).data.items.length,
          1,
        );
        assert.equal((await request("/todos?limit=bad")).status, 422);
        assert.equal(
          (await request(`/todos/${data.id}`, "DELETE")).status,
          200,
        );
        assert.equal((await request(`/todos/${data.id}`)).status, 404);
        assert.equal(
          spec.paths["/todos/{id}"].get.parameters.find(
            (value) => value.name === "id",
          ).required,
          true,
        );
      }
    } finally {
      await stop(operation);
      await portProbe(port);
      operation.record.cleanup = "process tree stopped; listener released";
      console.log(
        JSON.stringify({
          phase: "closed",
          example: name,
          pid: operation.child.pid,
          port,
        }),
      );
    }
  }
} catch (error) {
  failure = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    if (database) {
      await database.stop();
      if (databaseRecord?.port) await portProbe(databaseRecord.port);
      if (databaseRecord)
        databaseRecord.cleanup = "process stopped; listener released";
      console.log(
        JSON.stringify({ phase: "database-closed", ...databaseRecord }),
      );
    }
  } catch (error) {
    failure ??= String(error);
    console.error(error);
    process.exitCode = 1;
  }
  // Publish one result only after application and database cleanup has succeeded.
  const status = failure ? "FAIL" : "PASS";
  writeFileSync(
    path.join(workspace, "result.json"),
    JSON.stringify(
      {
        status,
        ...(failure ? { error: failure } : {}),
        node: process.version,
        tarball,
        sha256: createHash("sha256")
          .update(readFileSync(tarball))
          .digest("hex"),
        records,
        database: databaseRecord,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status, workspace }));
}

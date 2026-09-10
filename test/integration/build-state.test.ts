import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

function launch(
  entry: string,
  args: string[],
  root: string,
  env: NodeJS.ProcessEnv = {},
  ipc = false,
) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: root,
    env: {
      ...process.env,
      VEXT_BUILD_OUTDIR: undefined,
      VEXT_BUILD_ID: undefined,
      ...env,
    },
    stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout?.on("data", (data) => {
    output = (output + String(data)).slice(-20_000);
  });
  child.stderr?.on("data", (data) => {
    output = (output + String(data)).slice(-20_000);
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
  console.log(
    `[build CLI probe] command=node ${entry} ${args.join(" ")} cwd=${root} pid=${child.pid}`,
  );
  return { child, closed, output: () => output };
}

async function stop(child: ChildProcess, closed: Promise<number | null>) {
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    if (child.exitCode === null && child.signalCode === null) {
      if (child.connected)
        child.send({ type: "shutdown" }, (error) => {
          if (error) child.kill();
        });
      else child.kill();
    }
    await closed;
  } finally {
    clearTimeout(timer);
  }
}

async function cli(entry: string, root: string, args: string[]) {
  const running = launch(entry, args, root);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    running.child.kill("SIGKILL");
  }, 20_000);
  try {
    const code = await running.closed;
    expect(timedOut, running.output()).toBe(false);
    return { code, output: running.output() };
  } finally {
    clearTimeout(timer);
    await stop(running.child, running.closed);
    console.log(`[build CLI probe] closed pid=${running.child.pid}`);
  }
}

async function bindPort(port = 0) {
  const server = createServer();
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing TCP address");
    return address.port;
  } finally {
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
}

async function verifyProduction(
  entry: string,
  root: string,
  port: number,
  buildId: string,
) {
  const running = launch(
    entry,
    [],
    root,
    {
      NODE_ENV: "production",
      VEXT_MODE: "start",
      VEXT_ROOT: root,
      VEXT_CONFIG: "production",
      VEXT_BUILT: "1",
      VEXT_BUILD_ID: buildId,
      VEXT_BUILD_OUTDIR: path.join(root, "release"),
      VEXT_PORT: String(port),
      VEXT_HOST: "127.0.0.1",
    },
    true,
  );
  const url = `http://127.0.0.1:${port}/health`;
  console.log(
    `[build CLI probe] production bootstrap pid=${running.child.pid} url=${url}`,
  );
  try {
    const deadline = Date.now() + 15_000;
    let last = "No response";
    let ready = false;
    while (Date.now() < deadline) {
      if (running.child.exitCode !== null || running.child.signalCode !== null)
        break;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(1000),
        });
        last = `${response.status} ${await response.text()}`;
        if (last.startsWith("200 ")) {
          expect(JSON.parse(last.slice(4))).toMatchObject({
            data: { value: "repaired" },
          });
          ready = true;
          break;
        }
      } catch (error) {
        last = String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready, `${last}\n${running.output()}`).toBe(true);
  } finally {
    await stop(running.child, running.closed);
    await bindPort(port);
    console.log(
      `[build CLI probe] closed production pid=${running.child.pid}, released port=${port}`,
    );
  }
  expect(running.child.exitCode, running.output()).toBe(0);
}

describe("real build state and portable compiled deployment", () => {
  it("blocks failed builds, recovers after repair and serves without source or local freshness state", async () => {
    const repository = process.cwd();
    const entry = path.join(repository, "dist/cli/index.js");
    const bootstrap = path.join(repository, "dist/lib/bootstrap.js");
    expect(
      existsSync(entry),
      "Run npm run build before this integration test",
    ).toBe(true);
    const root = await mkdtemp(path.join(tmpdir(), "vext-build-cli-state-"));
    const project = path.join(root, "project");
    const deployment = path.join(root, "deployment");
    const port = await bindPort();
    const write = async (file: string, content: string) => {
      const target = path.join(project, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    };
    const read = (file: string) => readFile(path.join(project, file), "utf8");
    const linkDependencies = async (directory: string) => {
      await mkdir(path.join(directory, "node_modules"));
      await symlink(
        repository,
        path.join(directory, "node_modules/vextjs"),
        process.platform === "win32" ? "junction" : "dir",
      );
    };
    const route = (
      value: string,
      duplicate = false,
    ) => `import { defineRoutes } from 'vextjs';
      export default defineRoutes(app => {
        app.get('/health', {}, async (_req, res) => { res.json({ value: '${value}' }); });
        ${duplicate ? "app.get('/health', {}, async (_req, res) => { res.json({ duplicate: true }); });" : ""}
      });`;
    try {
      const framework = JSON.parse(
        await readFile(path.join(repository, "package.json"), "utf8"),
      );
      await write(
        "package.json",
        JSON.stringify({
          name: "build-state-fixture",
          type: "module",
          dependencies: { vextjs: framework.version },
        }),
      );
      await linkDependencies(project);
      await write(
        "src/config/default.ts",
        `export default { adapter: 'native', host: '127.0.0.1', port: ${port}, logger: { level: 'error' }, frontend: false };`,
      );
      await write("src/routes/index.ts", route("initial"));
      const first = await cli(entry, project, ["build", "--outdir", "release"]);
      expect(first.code, first.output).toBe(0);
      expect(first.output).toContain("✅ build complete");
      const previous = await read(".vext/build-location.json");
      const oldRoute = await read("release/routes/index.js");

      await write("src/routes/index.ts", route("invalid", true));
      const failed = await cli(entry, project, [
        "build",
        "--outdir",
        "release",
      ]);
      expect(failed.code, failed.output).toBe(1);
      expect(failed.output).toContain("Duplicate route identity GET /health");
      expect(failed.output).not.toContain("✅ build complete");
      expect(JSON.parse(await read("release/.vext-build.json")).status).toBe(
        "failed",
      );
      expect(await read(".vext/build-location.json")).toBe(previous);
      expect(await read("release/routes/index.js")).toBe(oldRoute);
      const blocked = await cli(entry, project, [
        "start",
        "--outdir",
        "release",
      ]);
      expect(blocked.code, blocked.output).toBe(1);
      expect(blocked.output).toContain("build identity");
      await bindPort(port);

      await write("src/routes/index.ts", route("repaired"));
      const repaired = await cli(entry, project, ["build"]);
      expect(repaired.code, repaired.output).toBe(0);
      let identity = JSON.parse(await read("release/.vext-build.json"));
      expect(identity).toMatchObject({
        status: "ready",
        outDir: "release",
        profile: "production",
        backend: "compiled",
      });
      expect(JSON.parse(await read(".vext/build-location.json"))).toEqual(
        identity,
      );
      expect(identity.buildId).not.toBe(JSON.parse(previous).buildId);
      await verifyProduction(bootstrap, project, port, identity.buildId);

      await rm(path.join(project, ".vext/build-location.json"));
      const missingStart = await cli(entry, project, ["start"]);
      expect(missingStart.code, missingStart.output).toBe(1);
      expect(missingStart.output).toContain("build identity");
      const missingBuild = await cli(entry, project, ["build"]);
      expect(missingBuild.code, missingBuild.output).toBe(1);
      expect(missingBuild.output).toContain(
        "recorded build location is missing",
      );
      const explicit = await cli(entry, project, [
        "build",
        "--outdir",
        "release",
      ]);
      expect(explicit.code, explicit.output).toBe(0);
      identity = JSON.parse(await read("release/.vext-build.json"));
      expect(JSON.parse(await read(".vext/build-location.json"))).toEqual(
        identity,
      );

      await mkdir(path.join(deployment, ".vext"), { recursive: true });
      await cp(
        path.join(project, "release"),
        path.join(deployment, "release"),
        { recursive: true },
      );
      await cp(
        path.join(project, "package.json"),
        path.join(deployment, "package.json"),
      );
      await cp(
        path.join(project, ".vext/build-location.json"),
        path.join(deployment, ".vext/build-location.json"),
      );
      await linkDependencies(deployment);
      expect(existsSync(path.join(deployment, "src"))).toBe(false);
      expect(existsSync(path.join(deployment, ".vext/freshness"))).toBe(false);
      await verifyProduction(bootstrap, deployment, port, identity.buildId);
    } finally {
      await bindPort(port);
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

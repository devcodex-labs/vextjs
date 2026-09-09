import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function port(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No TCP address");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitFor(assertion: () => Promise<void>, label: string) {
  const deadline = Date.now() + 15_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label}: ${String(last)}`);
}

function run(cli: string, root: string, args: string[]) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output = (output + String(data)).slice(-20_000);
  });
  child.stderr.on("data", (data) => {
    output = (output + String(data)).slice(-20_000);
  });
  const completed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  return { child, completed, output: () => output };
}

async function stop(child: ChildProcess, completed: Promise<unknown>) {
  if (child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
  await completed;
}

describe("built CLI project ownership", () => {
  it("applies a port change saved while the initial configuration provider is still loading", async () => {
    const repository = process.cwd();
    const cli = path.join(repository, "dist/cli/index.js");
    const root = await mkdtemp(path.join(tmpdir(), "vext-cli-startup-save-"));
    const firstPort = await port();
    const nextPort = await port();
    let running: ReturnType<typeof run> | undefined;
    try {
      await mkdir(path.join(root, "src/config"), { recursive: true });
      await mkdir(path.join(root, "src/routes"), { recursive: true });
      await mkdir(path.join(root, "node_modules"));
      await symlink(
        repository,
        path.join(root, "node_modules/vextjs"),
        process.platform === "win32" ? "junction" : "dir",
      );
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({
          name: "startup-save",
          type: "module",
          dependencies: { vextjs: "2.0.0" },
        }),
      );
      const config = (selected: number) =>
        `export default { port: ${selected}, host: '127.0.0.1', adapter: 'native', frontend: false, logger: { level: 'error' } };`;
      await writeFile(
        path.join(root, "src/config/default.js"),
        config(firstPort),
      );
      await writeFile(path.join(root, "hold-provider"), "hold");
      await writeFile(
        path.join(root, "src/config/bootstrap.js"),
        `import { appendFileSync, existsSync } from 'node:fs'; import { join } from 'node:path'; import { setTimeout } from 'node:timers/promises'; export default { providers: [{ name: 'wait', required: true, async load(ctx) { appendFileSync(join(ctx.rootDir, 'providers.txt'), 'dev\\n'); while (existsSync(join(ctx.rootDir, 'hold-provider'))) await setTimeout(20); return {}; } }] };`,
      );
      await writeFile(
        path.join(root, "src/routes/index.js"),
        `import { defineRoutes } from 'vextjs'; export default defineRoutes(app => { app.get('/health', {}, async (_req, res) => res.json({ ready: true })); });`,
      );
      running = run(cli, root, ["dev", "--poll", "--poll-interval", "30"]);
      console.log(
        `[CLI startup save probe] command=node ${cli} dev --poll --poll-interval 30 cwd=${root} pid=${running.child.pid} ports=${firstPort},${nextPort}`,
      );
      await waitFor(async () => {
        expect(await readFile(path.join(root, "providers.txt"), "utf8")).toBe(
          "dev\n",
        );
      }, "initial provider reached");
      await writeFile(
        path.join(root, "src/config/default.js"),
        config(nextPort),
      );
      await rm(path.join(root, "hold-provider"));
      await waitFor(async () => {
        const response = await fetch(`http://127.0.0.1:${nextPort}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ data: { ready: true } });
      }, "latest port became ready");
      expect(await readFile(path.join(root, "providers.txt"), "utf8")).toBe(
        "dev\ndev\n",
      );
    } catch (error) {
      throw new Error(
        `${String(error)}\n${running?.output() ?? "not started"}`,
        { cause: error },
      );
    } finally {
      if (running) await stop(running.child, running.completed);
      for (const selected of [firstPort, nextPort])
        await waitFor(async () => {
          const server = createServer();
          try {
            server.listen(selected, "127.0.0.1");
            await once(server, "listening");
          } finally {
            if (server.listening)
              await new Promise<void>((resolve) =>
                server.close(() => resolve()),
              );
          }
        }, `startup probe port ${selected} release`);
      console.log(
        `[CLI startup save probe] exited parent PID ${running?.child.pid}; both ports released`,
      );
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000);

  it("runs two services, rejects competing writers before providers, reloads, and recovers after parent death", async () => {
    const repository = process.cwd();
    const cli = path.join(repository, "dist/cli/index.js");
    expect(existsSync(cli), "Run npm run build before integration tests").toBe(
      true,
    );
    const root = await mkdtemp(path.join(tmpdir(), "vext-cli-owner-"));
    const services: Array<{
      root: string;
      port: number;
      name: string;
      process: ReturnType<typeof run>;
    }> = [];
    const transient: ReturnType<typeof run>[] = [];
    const write = async (project: string, file: string, text: string) => {
      await mkdir(path.dirname(path.join(project, file)), { recursive: true });
      await writeFile(path.join(project, file), text);
    };
    const route = (name: string, value: string) =>
      `import { defineRoutes } from 'vextjs'; export default defineRoutes(app => { app.get('/health', {}, async (_req, res) => { res.json({ service: '${name}', value: '${value}' }); }); });`;
    const health = async (
      service: { port: number; name: string },
      value: string,
    ) => {
      const response = await fetch(`http://127.0.0.1:${service.port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { service: service.name, value },
      });
    };
    try {
      for (const name of ["a", "b"]) {
        const project = path.join(root, name);
        const selectedPort = await port();
        await write(
          project,
          "package.json",
          JSON.stringify({
            name: `owner-${name}`,
            type: "module",
            dependencies: { vextjs: "2.0.0" },
          }),
        );
        await mkdir(path.join(project, "node_modules"));
        await symlink(
          repository,
          path.join(project, "node_modules/vextjs"),
          process.platform === "win32" ? "junction" : "dir",
        );
        await write(
          project,
          "src/config/default.js",
          `export default { adapter: 'native', host: '127.0.0.1', port: ${selectedPort}, logger: { level: 'error' }, frontend: false };`,
        );
        await write(
          project,
          "src/config/bootstrap.js",
          `import { appendFileSync } from 'node:fs'; import { join } from 'node:path'; export default { providers: [{ name: 'counter', required: true, load(ctx) { appendFileSync(join(ctx.rootDir, 'providers.txt'), ctx.command + '\\n'); return {}; } }] };`,
        );
        await write(project, "src/routes/index.js", route(name, "initial"));
        const running = run(cli, project, [
          "dev",
          "--poll",
          "--poll-interval",
          "50",
        ]);
        services.push({
          root: project,
          port: selectedPort,
          name,
          process: running,
        });
        console.log(
          `[CLI owner probe] command=node ${cli} dev --poll --poll-interval 50 cwd=${project} pid=${running.child.pid} url=http://127.0.0.1:${selectedPort}`,
        );
      }
      await Promise.all(
        services.map((service) =>
          waitFor(
            () => health(service, "initial"),
            `readiness ${service.name}`,
          ),
        ),
      );
      const first = services[0]!;
      for (const command of [["dev"], ["build", "--clean"], ["typegen"]]) {
        const competitor = run(cli, first.root, command);
        transient.push(competitor);
        expect(await competitor.completed, competitor.output()).toBe(1);
        expect(competitor.output()).toContain("VEXT_OWNER_BUSY");
      }
      expect(
        await readFile(path.join(first.root, "providers.txt"), "utf8"),
      ).toBe("dev\n");
      expect(existsSync(path.join(first.root, "dist"))).toBe(false);
      const check = run(cli, first.root, ["typegen", "--check", "--json"]);
      transient.push(check);
      expect(await check.completed, check.output()).toBe(0);
      expect(JSON.parse(check.output()).ok).toBe(true);
      await write(first.root, "src/routes/index.js", route("a", "updated"));
      await waitFor(
        () => health(first, "updated"),
        "hot reload with inherited owner",
      );
      await health(services[1]!, "initial");
      await stop(first.process.child, first.process.completed);
      await waitFor(async () => {
        const server = createServer();
        try {
          server.listen(first.port, "127.0.0.1");
          await once(server, "listening");
        } finally {
          if (server.listening)
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }, "orphan worker port release");
      const recovered = run(cli, first.root, ["build"]);
      transient.push(recovered);
      expect(await recovered.completed, recovered.output()).toBe(0);
      expect(
        await readFile(path.join(first.root, "providers.txt"), "utf8"),
      ).toBe("dev\nbuild\n");
      await health(services[1]!, "initial");
    } catch (error) {
      throw new Error(
        `${String(error)}\n${services.map((service) => `${service.name}: ${service.process.output()}`).join("\n")}`,
        { cause: error },
      );
    } finally {
      for (const process of transient)
        await stop(process.child, process.completed);
      for (const service of services.reverse()) {
        await stop(service.process.child, service.process.completed);
        await waitFor(async () => {
          const server = createServer();
          try {
            server.listen(service.port, "127.0.0.1");
            await once(server, "listening");
          } finally {
            if (server.listening)
              await new Promise<void>((resolve) =>
                server.close(() => resolve()),
              );
          }
        }, `port ${service.port} cleanup`);
        console.log(
          `[CLI owner probe] exited parent PID ${service.process.child.pid}; port ${service.port} released`,
        );
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

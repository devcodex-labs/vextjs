import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
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

async function availablePort(): Promise<number> {
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

async function stopWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    if (child.connected) child.send({ type: "shutdown" });
    else child.kill();
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

async function operation(
  child: ChildProcess,
  kind: "reload" | "frontend-rebuild",
  files: { path: string; type: "add" | "modify" | "delete" }[],
): Promise<Record<string, unknown>> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = () =>
      fail(new Error("Worker exited without operation result"));
    const onMessage = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const message = value as Record<string, unknown>;
      if (
        message.type !== "dev-operation-result" ||
        message.requestId !== requestId
      )
        return;
      cleanup();
      resolve(message);
    };
    const timer = setTimeout(
      () => fail(new Error("Worker operation result timed out")),
      10_000,
    );
    child.on("message", onMessage);
    child.once("exit", onExit);
    child.send(
      { type: "dev-operation", requestId, operation: kind, files },
      (error) => {
        if (error) fail(error);
      },
    );
  });
}

async function assertPortReleased(port: number): Promise<void> {
  const server = createServer();
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function waitForText(url: string, expected: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  let last = "no response";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      last = `${response.status} ${await response.text()}`;
      if (last === `200 ${expected}`) return;
    } catch (error) {
      // 编译期间的单次超时仍受外层总时限约束，不能提前结束轮询。
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Expected ${expected} at ${url}; last response: ${last}`);
}

describe("built dev worker with dynamic directory configuration", () => {
  it("evaluates providers once, excludes browser sources and rebuilds configured static files over HTTP", async () => {
    const repository = process.cwd();
    const entry = path.join(repository, "dist/lib/dev/dev-entry.js");
    expect(
      existsSync(entry),
      "Run npm run build before runtime integration tests",
    ).toBe(true);
    const root = await mkdtemp(path.join(tmpdir(), "vext-dev-layout-"));
    const port = await availablePort();
    let child: ChildProcess | undefined;
    let output = "";
    try {
      const write = async (file: string, content: string) => {
        await mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await writeFile(path.join(root, file), content);
      };
      await write(
        "package.json",
        JSON.stringify({ name: "dev-layout-fixture", type: "module" }),
      );
      await mkdir(path.join(root, "node_modules"));
      await symlink(
        repository,
        path.join(root, "node_modules/vextjs"),
        "junction",
      );
      for (const name of ["react", "react-dom"]) {
        await symlink(
          path.join(repository, "node_modules", name),
          path.join(root, "node_modules", name),
          "junction",
        );
      }
      await write(
        "src/config/default.ts",
        `export default { port: ${port}, host: "127.0.0.1", adapter: "native", locale: { default: "en-US", supported: ["en-US", "zh-CN"] }, logger: { level: "error" } };`,
      );
      await write(
        "src/config/bootstrap.ts",
        `
        import { appendFileSync } from "node:fs";
        import { join } from "node:path";
        export default { providers: [{ name: "layout", required: true, load(ctx) {
          appendFileSync(join(ctx.rootDir, "provider.jsonl"), JSON.stringify({ command: ctx.command, isBuilt: ctx.isBuilt, configDir: ctx.configDir }) + "\\n");
          return { frontend: { enabled: true, root: "src/web", publicDir: "static", entry: "src/web/main.ts", apiClient: false } };
        } }] };
      `,
      );
      await write(
        "src/routes/index.ts",
        `import { defineRoutes } from "vextjs";
        export default defineRoutes(app => { app.get("/health", {}, async (_req, res) => { res.json({ status: "ok" }); }); });`,
      );
      await write(
        "src/routes/localized.ts",
        `import { defineRoutes } from "vextjs"; export default defineRoutes(app => { app.get("/", { docs: { hidden: true } }, req => req.app.throw("order.payment.denied")); });`,
      );
      const localeFile = "src/locales/order/payment/en-US.json";
      const locale = (message: string) =>
        JSON.stringify({
          "order.payment.denied": { code: 40901, message, statusCode: 409 },
        });
      await write(localeFile, locale("initial message"));
      await write("src/web/main.ts", 'document.body.dataset.ready = "yes";');
      await write(
        "src/web/pages/_document.html",
        "<!doctype html><html><head></head><body>{vext.root}{vext.data}{vext.entry}</body></html>",
      );
      await write("static/robots.txt", "User-agent: *");

      child = fork(entry, [], {
        cwd: root,
        execArgv: [],
        env: {
          ...process.env,
          NODE_ENV: "development",
          VEXT_ROOT: root,
          VEXT_CONFIG: "development",
          VEXT_PORT: String(port),
          VEXT_HOST: "127.0.0.1",
          VEXT_DEV_MODE: "1",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      console.log(
        `[dev layout probe] command=node ${entry} cwd=${root} pid=${child.pid} url=http://127.0.0.1:${port}`,
      );
      child.stdout?.on("data", (data) => {
        output = (output + String(data)).slice(-20_000);
      });
      child.stderr?.on("data", (data) => {
        output = (output + String(data)).slice(-20_000);
      });
      const messages: Record<string, unknown>[] = [];
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => done(new Error(`Worker readiness timeout: ${output}`)),
          20_000,
        );
        const onExit = (code: number | null) =>
          done(new Error(`Worker exited ${code}: ${output}`));
        const onMessage = (value: unknown) => {
          if (!value || typeof value !== "object") return;
          const message = value as Record<string, unknown>;
          messages.push(message);
          if (message.type === "ready") done();
        };
        const done = (error?: Error) => {
          clearTimeout(timer);
          child!.off("exit", onExit);
          child!.off("message", onMessage);
          error ? reject(error) : resolve();
        };
        child!.on("message", onMessage);
        child!.once("exit", onExit);
      });
      expect(
        messages.filter((message) => message.type === "watch-layout"),
      ).toHaveLength(1);
      expect(
        messages.find((message) => message.type === "watch-layout")?.layout,
      ).toMatchObject({
        frontendDirectories: expect.arrayContaining(["src/web", "static"]),
      });
      const providerCalls = (
        await readFile(path.join(root, "provider.jsonl"), "utf8")
      )
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(providerCalls).toEqual([
        {
          command: "dev",
          isBuilt: false,
          configDir: path.join(root, "src/config"),
        },
      ]);
      expect(existsSync(path.join(root, ".vext/dev/web/main.js"))).toBe(false);
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({ data: { status: "ok" } });
      const localized = async (language = "en-US") => {
        const response = await fetch(`http://127.0.0.1:${port}/localized`, {
          headers: { "accept-language": language },
        });
        return { status: response.status, body: await response.json() };
      };
      expect(await localized()).toMatchObject({
        status: 409,
        body: { code: 40901, message: "initial message" },
      });
      await write(localeFile, locale("updated message"));
      expect(
        await operation(child, "reload", [
          { path: localeFile, type: "modify" },
        ]),
      ).toMatchObject({ success: true });
      expect(await localized()).toMatchObject({
        body: { message: "updated message" },
      });
      await write(localeFile, "{invalid json");
      expect(
        await operation(child, "reload", [
          { path: localeFile, type: "modify" },
        ]),
      ).toMatchObject({ success: false, requestedColdRestart: false });
      expect(await localized()).toMatchObject({
        body: { message: "updated message" },
      });
      await write(localeFile, locale("recovered message"));
      expect(
        await operation(child, "reload", [
          { path: localeFile, type: "modify" },
        ]),
      ).toMatchObject({ success: true });
      expect(await localized()).toMatchObject({
        body: { message: "recovered message" },
      });
      const chineseFile = "src/locales/order/payment/zh-CN.json";
      await write(chineseFile, locale("付款被拒绝"));
      expect(
        await operation(child, "reload", [{ path: chineseFile, type: "add" }]),
      ).toMatchObject({ success: true });
      expect(await localized("zh-CN")).toMatchObject({
        body: { message: "付款被拒绝" },
      });
      await rm(path.join(root, chineseFile));
      expect(
        await operation(child, "reload", [
          { path: chineseFile, type: "delete" },
        ]),
      ).toMatchObject({ success: true });
      expect(await localized("zh-CN")).toMatchObject({
        body: { message: "recovered message" },
      });
      expect(
        existsSync(
          path.join(root, ".vext/dev/locales/order/payment/zh-CN.json"),
        ),
      ).toBe(false);
      await waitForText(`http://127.0.0.1:${port}/robots.txt`, "User-agent: *");
      await write("static/robots.txt", "User-agent: *\nDisallow: /private");
      child.send({
        type: "frontend-rebuild",
        files: [{ path: "static/robots.txt", type: "modify" }],
      });
      await waitForText(
        `http://127.0.0.1:${port}/robots.txt`,
        "User-agent: *\nDisallow: /private",
      );
      await write("static/robots.txt", "User-agent: *\nAllow: /");
      const rebuilt = await operation(child, "frontend-rebuild", [
        { path: "static/robots.txt", type: "modify" },
      ]);
      expect(rebuilt.success).toBe(true);
      expect(
        await (await fetch(`http://127.0.0.1:${port}/robots.txt`)).text(),
      ).toBe("User-agent: *\nAllow: /");
      const frontendManifestPath = path.join(
        root,
        ".vext/client/manifest.json",
      );
      const lastFrontend = await readFile(frontendManifestPath, "utf8");
      await write("src/web/main.ts", "export const = invalid;");
      await write("static/robots.txt", "recovered frontend");
      const frontendFailed = await operation(child, "frontend-rebuild", [
        { path: "src/web/main.ts", type: "modify" },
        { path: "static/robots.txt", type: "modify" },
      ]);
      expect(frontendFailed.success).toBe(false);
      expect(await readFile(frontendManifestPath, "utf8")).toBe(lastFrontend);
      expect(
        await (await fetch(`http://127.0.0.1:${port}/robots.txt`)).text(),
      ).toBe("User-agent: *\nAllow: /");
      await write(
        "src/web/main.ts",
        'document.body.dataset.ready = "recovered";',
      );
      const frontendRecovered = await operation(child, "frontend-rebuild", [
        { path: "src/web/main.ts", type: "modify" },
      ]);
      expect(frontendRecovered.success).toBe(true);
      expect(await readFile(frontendManifestPath, "utf8")).not.toBe(
        lastFrontend,
      );
      expect(
        await (await fetch(`http://127.0.0.1:${port}/robots.txt`)).text(),
      ).toBe("recovered frontend");
      const route = (status: string) =>
        `import { defineRoutes } from 'vextjs'; export default defineRoutes(app => { app.get('/health', {}, async (_req, res) => { res.json({ status: '${status}' }); }); });`;
      await write("src/routes/index.ts", route("updated"));
      const reloaded = await operation(child, "reload", [
        { path: "src/routes/index.ts", type: "modify" },
      ]);
      expect(reloaded.success).toBe(true);
      expect(
        await (await fetch(`http://127.0.0.1:${port}/health`)).json(),
      ).toMatchObject({ data: { status: "updated" } });
      await write("src/routes/index.ts", "export default <invalid;");
      const failed = await operation(child, "reload", [
        { path: "src/routes/index.ts", type: "modify" },
      ]);
      expect(failed).toMatchObject({
        success: false,
        requestedColdRestart: false,
      });
      expect(
        await (await fetch(`http://127.0.0.1:${port}/health`)).json(),
      ).toMatchObject({ data: { status: "updated" } });
      await write("src/routes/index.ts", route("manual-full"));
      const full = await operation(child, "reload", [
        { path: "src/", type: "modify" },
      ]);
      expect(full.success).toBe(true);
      expect(
        await (await fetch(`http://127.0.0.1:${port}/health`)).json(),
      ).toMatchObject({ data: { status: "manual-full" } });
      expect(
        (await readFile(path.join(root, "provider.jsonl"), "utf8"))
          .trim()
          .split("\n"),
      ).toHaveLength(1);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : error}\n${output}`,
        { cause: error },
      );
    } finally {
      if (child) {
        await stopWorker(child);
        expect(child.exitCode, output).toBe(0);
      }
      await assertPortReleased(port);
      console.log(
        `[dev layout probe] closed pid=${child?.pid} released port=${port}`,
      );
      await rm(root, { recursive: true, force: true });
    }
  }, 35_000);
});

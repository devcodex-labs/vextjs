import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFrontendWatchLayout,
  isFrontendWatchLayout,
  createProjectWatchLayout,
  isProjectWatchLayout,
} from "../../src/lib/project/layout.js";
import {
  classifyChange,
  matchGlobPattern,
} from "../../src/lib/dev/change-classifier.js";
import {
  VextFileWatcher,
  type FileChangeEvent,
} from "../../src/lib/dev/file-watcher.js";
import { readWatchSnapshot } from "../../src/lib/dev/watch-snapshot.js";
import { withProjectOwner } from "../../src/lib/project/owner.js";
import { withTemporaryArtifact } from "../../src/lib/project/temporary-artifact.js";

const roots: string[] = [];
const watchers: VextFileWatcher[] = [];
afterEach(async () => {
  for (const watcher of watchers.splice(0)) watcher.stop();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function nextChange(
  watcher: VextFileWatcher,
  file: string,
  type?: string,
): Promise<FileChangeEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.off("change", listener);
      reject(new Error(`No watcher event for ${file} (${type ?? "any"})`));
    }, 5000);
    const listener = (event: FileChangeEvent) => {
      if (
        !event.files.some(
          (item) => item.path === file && (!type || item.type === type),
        )
      )
        return;
      clearTimeout(timer);
      watcher.off("change", listener);
      resolve(event);
    };
    watcher.on("change", listener);
  });
}

describe("dev watcher resolved layout", () => {
  it.each([false, true])(
    "ignores executable config temporaries while observing real config changes (poll=%s)",
    async (usePolling) => {
      const root = await mkdtemp(path.join(tmpdir(), "vext-watch-temporary-"));
      roots.push(root);
      const directory = path.join(root, "src/config");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "default.ts"), "export default {};");
      const watcher = new VextFileWatcher({
        root,
        usePolling,
        pollInterval: 30,
        debounce: 15,
      });
      watchers.push(watcher);
      const events: FileChangeEvent[] = [];
      watcher.on("change", (event) => events.push(event));
      await withProjectOwner(root, "dev", [directory], async () => {
        await withTemporaryArtifact(
          {
            rootDir: root,
            logicalPath: path.join(directory, "default.mjs"),
            contents: "export default {};",
          },
          async (temporary) => {
            const relative = path
              .relative(root, temporary)
              .replaceAll("\\", "/");
            expect(
              classifyChange(relative, { coldPatterns: ["src/**"] }).action,
            ).toBe("ignore");
            expect((await readWatchSnapshot(root)).has(relative)).toBe(false);
            await watcher.start();
          },
        );
        await withTemporaryArtifact(
          {
            rootDir: root,
            logicalPath: path.join(directory, "default.cjs"),
            contents: "module.exports = {};",
          },
          async (temporary) => {
            const relative = path
              .relative(root, temporary)
              .replaceAll("\\", "/");
            expect((await readWatchSnapshot(root)).has(relative)).toBe(false);
            const changed = nextChange(
              watcher,
              "src/config/default.ts",
              "modify",
            );
            await writeFile(
              path.join(directory, "default.ts"),
              "export default { port: 3123 };",
            );
            expect((await changed).action).toBe("cold");
          },
        );
        const added = nextChange(watcher, "src/config/development.ts", "add");
        await writeFile(
          path.join(directory, "development.ts"),
          "export default {};",
        );
        await added;
      });
      expect(
        events
          .flatMap((event) => event.files)
          .some((file) => file.path.includes(".vext-exec-")),
      ).toBe(false);
      expect(classifyChange("src/config/.env.local").action).toBe("cold");
      expect(classifyChange("src/config/.vext-exec-user.mjs").action).toBe(
        "cold",
      );
    },
  );

  it.each([false, true])(
    "observes locale JSON and explicit external model sources through the real watcher (poll=%s)",
    async (usePolling) => {
      const root = await mkdtemp(path.join(tmpdir(), "vext-watch-backend-"));
      roots.push(root);
      const shared = await mkdtemp(path.join(tmpdir(), "vext-watch-shared-"));
      roots.push(shared);
      await mkdir(path.join(root, "src/translations/order"), {
        recursive: true,
      });
      await writeFile(
        path.join(root, "src/translations/order/en-US.json"),
        '{"title":"before"}',
      );
      await writeFile(
        path.join(shared, "user.ts"),
        'export default { collection: "users" };',
      );
      const layout = createProjectWatchLayout(root, {
        localeDirectory: "src/translations",
        modelsDirectory: shared,
      });
      expect(isProjectWatchLayout(layout)).toBe(true);
      expect(
        classifyChange("src/frontend/helper.ts", { ...layout, rootDir: root })
          .action,
      ).toBe("soft");
      const watcher = new VextFileWatcher({
        root,
        usePolling,
        pollInterval: 30,
        debounce: 15,
        classifierOptions: layout,
      });
      watchers.push(watcher);
      await watcher.start();
      const changed = nextChange(
        watcher,
        "src/translations/order/en-US.json",
        "modify",
      );
      await writeFile(
        path.join(root, "src/translations/order/en-US.json"),
        '{"title":"after"}',
      );
      expect((await changed).action).toBe("soft");
      const added = nextChange(
        watcher,
        "src/translations/order/zh-CN.json",
        "add",
      );
      await writeFile(
        path.join(root, "src/translations/order/zh-CN.json"),
        '{"title":"新文案"}',
      );
      expect((await added).action).toBe("soft");
      const deleted = nextChange(
        watcher,
        "src/translations/order/en-US.json",
        "delete",
      );
      await rm(path.join(root, "src/translations/order/en-US.json"));
      expect((await deleted).action).toBe("soft");
      const sharedChange = nextChange(
        watcher,
        path.relative(root, path.join(shared, "user.ts")).replaceAll("\\", "/"),
      );
      await writeFile(
        path.join(shared, "user.ts"),
        'export default { collection: "users", fields: { name: "string" } };',
      );
      expect((await sharedChange).action).toBe("cold");
    },
  );

  it("projects only portable paths and preserves explicit classification overrides", () => {
    const root = path.resolve("project");
    const layout = createFrontendWatchLayout(root, {
      enabled: true,
      root: "web",
      publicDir: "static",
    });
    expect(isFrontendWatchLayout(layout)).toBe(true);
    expect(classifyChange("web/pages/home.tsx", layout).action).toBe("client");
    expect(classifyChange("static/robots.txt", layout).action).toBe("client");
    expect(classifyChange("src/services/user.ts", layout).action).toBe("soft");
    expect(
      classifyChange("web/pages/home.tsx", {
        ...layout,
        ignorePatterns: ["web/**"],
      }).action,
    ).toBe("ignore");
    expect(
      classifyChange("web/pages/home.tsx", {
        ...layout,
        coldPatterns: ["web/**"],
      }).action,
    ).toBe("cold");
    expect(matchGlobPattern("src/x.ts", "src/?.ts")).toBe(false);
    expect(
      isFrontendWatchLayout({
        frontendDirectories: ["../other"],
        frontendFiles: [],
      }),
    ).toBe(false);
    expect(
      isFrontendWatchLayout({
        frontendDirectories: ["C:\\other"],
        frontendFiles: [],
      }),
    ).toBe(false);
  });

  it.each([false, true])(
    "observes custom paths, arbitrary public files and .mts deletion (poll=%s)",
    async (usePolling) => {
      const root = await mkdtemp(path.join(tmpdir(), "vext-watch-layout-"));
      roots.push(root);
      await mkdir(path.join(root, "src/services"), { recursive: true });
      await mkdir(path.join(root, "web/pages"), { recursive: true });
      await mkdir(path.join(root, "static"), { recursive: true });
      await writeFile(
        path.join(root, "src/services/user.mts"),
        "export const count = 1;",
      );
      await writeFile(
        path.join(root, "web/pages/index.tsx"),
        "export default () => 'hello';",
      );
      await writeFile(path.join(root, "static/robots.txt"), "User-agent: *");
      const layout = createFrontendWatchLayout(root, {
        enabled: true,
        root: "web",
        publicDir: "static",
      });
      const watcher = new VextFileWatcher({
        root,
        usePolling,
        pollInterval: 30,
        debounce: 15,
        classifierOptions: layout,
      });
      watchers.push(watcher);
      await watcher.start();
      const page = nextChange(watcher, "web/pages/index.tsx");
      await writeFile(
        path.join(root, "web/pages/index.tsx"),
        "export default () => 'updated';",
      );
      expect((await page).action).toBe("client");
      const robots = nextChange(watcher, "static/robots.txt");
      await writeFile(
        path.join(root, "static/robots.txt"),
        "User-agent: *\nDisallow: /private",
      );
      expect((await robots).action).toBe("client");
      const binary = nextChange(watcher, "static/catalog.blob", "add");
      await writeFile(
        path.join(root, "static/catalog.blob"),
        Buffer.from([0, 1, 2]),
      );
      expect((await binary).action).toBe("client");
      const deleted = nextChange(watcher, "src/services/user.mts", "delete");
      await rm(path.join(root, "src/services/user.mts"));
      expect((await deleted).action).toBe("soft");
    },
  );

  it("updates native watch roots after a new worker configuration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "vext-watch-update-"));
    roots.push(root);
    await mkdir(path.join(root, "src"));
    await mkdir(path.join(root, "web/pages"), { recursive: true });
    const watcher = new VextFileWatcher({ root, debounce: 15 });
    watchers.push(watcher);
    await watcher.start();
    watcher.updateClassifierOptions(
      createFrontendWatchLayout(root, { enabled: true, root: "web" }),
    );
    const event = nextChange(watcher, "web/pages/new.tsx");
    await writeFile(
      path.join(root, "web/pages/new.tsx"),
      "export default () => 'new';",
    );
    expect((await event).action).toBe("client");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveFrontendConfig } from "../../src/frontend/tooling/config-resolver.js";
import {
  deployFrontendAssets,
  FrontendDeployError,
} from "../../src/frontend/deploy/uploader.js";
import { readFrontendDeployState } from "../../src/frontend/deploy/state.js";
import { createFilesystemDeployAdapter } from "../../src/frontend/deploy/adapters/filesystem.js";
import {
  createSha256,
  createSriSha256,
} from "../../src/frontend/deploy/integrity.js";
import type {
  VextFrontendDeployManifest,
  VextFrontendDeployUploadAdapter,
  ResolvedVextFrontendConfig,
} from "../../src/frontend/contract/types.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture(contentPrefix = "") {
  const root = await mkdtemp(path.join(tmpdir(), "vext-deploy-v2-"));
  roots.push(root);
  const config = resolveFrontendConfig(
    {
      enabled: true,
      deploy: {
        upload: {
          enabled: true,
          adapter: "filesystem",
          targetDir: ".deploy/a",
          prefix: "release",
          concurrency: 1,
        },
      },
    },
    { rootDir: root, mode: "production" },
  );
  await mkdir(config.outDir, { recursive: true });
  const assets: VextFrontendDeployManifest["assets"] = [];
  for (const file of ["a.txt", "b.txt"]) {
    const content = Buffer.from(contentPrefix + file);
    await writeFile(path.join(config.outDir, file), content);
    assets.push({
      file,
      path: "/" + file,
      uploadKey: "release/" + file,
      bytes: content.length,
      sha256: createSha256(content),
      integrity: createSriSha256(content),
      contentType: "text/plain; charset=utf-8",
      source: "public",
      immutable: false,
    });
  }
  await writeFile(
    path.join(config.outDir, "public-manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      kind: "frontend-public-manifest",
      buildId: "fixture",
      files: assets.map((asset) => asset.file),
    }),
  );
  const manifest: VextFrontendDeployManifest = {
    schemaVersion: 1,
    kind: "frontend-deploy-manifest",
    generatedAt: new Date(0).toISOString(),
    mode: "production",
    outDir: "dist/client",
    publicPath: "/",
    upload: {
      enabled: true,
      adapter: "filesystem",
      prefix: "release",
      stateFile: ".vext/deploy/frontend-assets-state.json",
      dryRun: false,
    },
    assets,
  };
  const manifestPath = path.join(config.outDir, "deploy-manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, config, manifestPath };
}
function uploadConfig(
  config: ResolvedVextFrontendConfig,
  values: Partial<ResolvedVextFrontendConfig["deploy"]["upload"]>,
) {
  return {
    ...config,
    deploy: {
      ...config.deploy,
      upload: { ...config.deploy.upload, ...values },
    },
  };
}
async function failure(
  promise: Promise<unknown>,
): Promise<FrontendDeployError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FrontendDeployError);
    return error as FrontendDeployError;
  }
  throw new Error("expected incomplete deployment");
}

describe("frontend deploy target state v2", () => {
  it.each(["same-size", "larger", "deleted"])(
    "does not trust stale filesystem state after %s target changes",
    async (kind) => {
      const f = await fixture();
      await deployFrontendAssets(f);
      const destination = path.join(
        f.config.deploy.upload.targetDir!,
        "release/a.txt",
      );
      if (kind === "deleted") await rm(destination);
      else
        await writeFile(
          destination,
          kind === "same-size" ? "other" : "longer-than-the-recorded-file",
        );
      const retry = await deployFrontendAssets(f);
      expect(retry).toMatchObject({ uploaded: 1, skipped: 1 });
      expect(await readFile(destination, "utf8")).toBe("a.txt");
    },
  );

  it("reconciles sequential writes from another service instead of skipping its overwritten files", async () => {
    const first = await fixture();
    const second = await fixture("other-service-");
    const adapter = createFilesystemDeployAdapter(
      first.config.deploy.upload.targetDir!,
    );
    await deployFrontendAssets({ ...first, adapter });
    await deployFrontendAssets({ ...second, adapter });
    const retry = await deployFrontendAssets({ ...first, adapter });
    expect(retry).toMatchObject({ uploaded: 2, skipped: 0 });
    expect(
      await readFile(
        path.join(first.config.deploy.upload.targetDir!, "release/a.txt"),
        "utf8",
      ),
    ).toBe("a.txt");
  });

  it("shares state across parent/child targetDir aliases of the same physical directory", async () => {
    const f = await fixture();
    const first = await deployFrontendAssets({
      ...f,
      config: uploadConfig(f.config, { prefix: "sub/release" }),
    });
    const second = await deployFrontendAssets({
      ...f,
      config: uploadConfig(f.config, {
        targetDir: path.join(f.config.deploy.upload.targetDir!, "sub"),
        prefix: "release",
      }),
    });
    expect(second.targetId).toBe(first.targetId);
    expect(second.skipped).toBe(2);
    expect(
      Object.keys(
        (await readFrontendDeployState(first.stateFile)).targets[
          first.targetId!
        ]!.assets,
      ),
    ).toEqual(["a.txt", "b.txt"]);
  });

  it.each(["same-directory", "ancestor-directory", "independent-directory"])(
    "coordinates physical writes for %s",
    async (kind) => {
      const f = await fixture();
      const firstConfig = uploadConfig(f.config, { prefix: "sub/release" });
      const firstAdapter = createFilesystemDeployAdapter(
        firstConfig.deploy.upload.targetDir!,
      );
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((done) => {
        enter = done;
      });
      const gate = new Promise<void>((done) => {
        release = done;
      });
      const upload = firstAdapter.upload.bind(firstAdapter);
      firstAdapter.upload = async (input) => {
        enter();
        await gate;
        return upload(input);
      };
      const running = deployFrontendAssets({
        ...f,
        config: firstConfig,
        adapter: firstAdapter,
      });
      await Promise.race([
        entered,
        running.then(() => {
          throw new Error("Upload did not enter");
        }),
      ]);
      const secondConfig = uploadConfig(f.config, {
        targetDir: path.join(
          f.config.deploy.upload.targetDir!,
          kind === "independent-directory" ? "other" : "sub",
        ),
        prefix: kind === "ancestor-directory" ? "" : "release",
        stateFile: path.join(f.root, ".vext/deploy/independent.json"),
      });
      const secondAdapter = createFilesystemDeployAdapter(
        secondConfig.deploy.upload.targetDir!,
      );
      const secondUpload = vi.spyOn(secondAdapter, "upload");
      try {
        const pending = deployFrontendAssets({
          ...f,
          config: secondConfig,
          adapter: secondAdapter,
        });
        if (kind === "independent-directory")
          expect((await pending).uploaded).toBe(2);
        else {
          await expect(pending).rejects.toMatchObject({
            code: "VEXT_OWNER_BUSY",
          });
          expect(secondUpload).not.toHaveBeenCalled();
        }
      } finally {
        release();
        await running;
      }
      expect(
        (await deployFrontendAssets({ ...f, config: secondConfig })).uploaded,
      ).toBe(kind === "independent-directory" ? 0 : 2);
    },
  );
  it("partitions filesystem targets, profiles and prefixes while ignoring public URL changes", async () => {
    const f = await fixture();
    const first = await deployFrontendAssets(f);
    expect(first.uploaded).toBe(2);
    const urlOnly = await deployFrontendAssets({
      ...f,
      config: uploadConfig(f.config, {
        publicBaseUrl: "https://cdn.example.test/",
      }),
    });
    expect(urlOnly.targetId).toBe(first.targetId);
    expect(urlOnly.skipped).toBe(2);
    const b = uploadConfig(f.config, {
      targetDir: path.join(f.root, ".deploy/b"),
    });
    const second = await deployFrontendAssets({ ...f, config: b });
    expect(second.targetId).not.toBe(first.targetId);
    expect(second.uploaded).toBe(2);
    expect(
      await readFile(path.join(f.root, ".deploy/b/release/a.txt"), "utf8"),
    ).toBe("a.txt");
    const profile = await deployFrontendAssets({
      ...f,
      configProfile: "staging",
    });
    const prefix = await deployFrontendAssets({
      ...f,
      config: uploadConfig(f.config, { prefix: "other" }),
    });
    expect(profile.targetId).not.toBe(first.targetId);
    expect(prefix.targetId).not.toBe(first.targetId);
    expect(
      Object.keys((await readFrontendDeployState(first.stateFile)).targets),
    ).toHaveLength(4);
  });

  it("recognizes an existing filesystem junction as the same target", async () => {
    const f = await fixture();
    const first = await deployFrontendAssets(f);
    const alias = path.join(f.root, "target-alias");
    await symlink(
      f.config.deploy.upload.targetDir!,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    const second = await deployFrontendAssets({
      ...f,
      config: uploadConfig(f.config, { targetDir: alias }),
    });
    expect(second.targetId).toBe(first.targetId);
    expect(second.skipped).toBe(2);
  });

  it("keeps mock results separate from real success", async () => {
    const f = await fixture();
    const mock = await deployFrontendAssets({
      ...f,
      config: uploadConfig(f.config, { adapter: "mock" }),
    });
    expect(mock.uploaded).toBe(0);
    expect(mock.simulated).toBe(2);
    expect(existsSync(f.config.deploy.upload.targetDir!)).toBe(false);
    const real = await deployFrontendAssets(f);
    expect(real.uploaded).toBe(2);
    expect(real.targetId).not.toBe(mock.targetId);
    const state = await readFrontendDeployState(real.stateFile);
    expect(state.targets[mock.targetId!]!.simulation).toBe(true);
    expect(state.targets[real.targetId!]!.simulation).toBe(false);
  });

  it("dry-run never invokes adapters or creates state/target directories", async () => {
    const f = await fixture();
    const upload = vi.fn(async () => ({ uploaded: true }));
    const result = await deployFrontendAssets({
      ...f,
      dryRun: true,
      adapter: { name: "probe", targetIdentity: "bucket", upload },
    });
    expect(result.assets.map((asset) => asset.status)).toEqual([
      "planned",
      "planned",
    ]);
    expect(upload).not.toHaveBeenCalled();
    expect(existsSync(result.stateFile)).toBe(false);
    expect(existsSync(f.config.deploy.upload.targetDir!)).toBe(false);
  });

  it("does not reuse success when a custom storage identity is unknown", async () => {
    const f = await fixture();
    const upload = vi.fn(async () => ({ uploaded: true }));
    const adapter = { name: "custom", upload };
    expect((await deployFrontendAssets({ ...f, adapter })).targetId).toBeNull();
    const second = await deployFrontendAssets({ ...f, adapter });
    expect(second.uploaded).toBe(2);
    expect(upload).toHaveBeenCalledTimes(4);
    expect(existsSync(second.stateFile)).toBe(false);
  });

  it("commits only confirmed partial success and retries missing assets", async () => {
    const f = await fixture();
    const adapter: VextFrontendDeployUploadAdapter = {
      name: "cloud",
      targetIdentity: "account/bucket",
      async upload(input) {
        if (input.asset.file === "b.txt")
          throw new Error("remote disconnected");
        return { uploaded: true };
      },
    };
    const failed = await failure(deployFrontendAssets({ ...f, adapter }));
    expect(failed.result).toMatchObject({ uploaded: 1, unconfirmed: 1 });
    expect(
      Object.keys(
        (await readFrontendDeployState(failed.result.stateFile)).targets[
          failed.result.targetId!
        ]!.assets,
      ),
    ).toEqual(["release/a.txt"]);
    const retry = await deployFrontendAssets({
      ...f,
      adapter: {
        ...adapter,
        async upload() {
          return { uploaded: true };
        },
      },
    });
    expect(retry).toMatchObject({ uploaded: 1, skipped: 1 });
  });

  it("cancels queued uploads while recording already confirmed remote success", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const upload = vi.fn(async () => {
      controller.abort();
      return { uploaded: true };
    });
    const failed = await failure(
      deployFrontendAssets({
        ...f,
        signal: controller.signal,
        adapter: { name: "cloud", targetIdentity: "bucket", upload },
      }),
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(failed.result).toMatchObject({ uploaded: 1, cancelled: true });
    expect(failed.result.assets.map((asset) => asset.status)).toEqual([
      "uploaded",
      "cancelled",
    ]);
    expect(
      Object.keys(
        (await readFrontendDeployState(failed.result.stateFile)).targets[
          failed.result.targetId!
        ]!.assets,
      ),
    ).toEqual(["release/a.txt"]);
  });

  it.each(["same-state", "same-target", "nested-prefix"])(
    "rejects concurrent writers for %s and releases the lock",
    async (kind) => {
      const f = await fixture();
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const adapter = {
        name: "cloud",
        targetIdentity: "shared-bucket",
        async upload() {
          enter();
          await gate;
          return { uploaded: true };
        },
      };
      const running = deployFrontendAssets({ ...f, adapter });
      await entered;
      const config =
        kind === "same-state"
          ? f.config
          : uploadConfig(f.config, {
              stateFile: path.join(f.root, ".vext/deploy/other.json"),
              ...(kind === "nested-prefix" ? { prefix: "release/nested" } : {}),
            });
      try {
        await expect(
          deployFrontendAssets({ ...f, config, adapter }),
        ).rejects.toMatchObject({ code: "VEXT_OWNER_BUSY" });
      } finally {
        release();
        await running;
      }
      expect((await deployFrontendAssets({ ...f, adapter })).skipped).toBe(2);
    },
  );

  it("preserves unsupported state bytes and invokes no adapter", async () => {
    const f = await fixture();
    const stateFile = f.config.deploy.upload.stateFile;
    await mkdir(path.dirname(stateFile), { recursive: true });
    const bytes =
      '{"schemaVersion":1,"kind":"frontend-deploy-state","assets":{}}';
    await writeFile(stateFile, bytes);
    const upload = vi.fn(async () => ({ uploaded: true }));
    await expect(
      deployFrontendAssets({
        ...f,
        adapter: { name: "cloud", targetIdentity: "bucket", upload },
      }),
    ).rejects.toThrow(/schemaVersion 2/);
    expect(upload).not.toHaveBeenCalled();
    expect(await readFile(stateFile, "utf8")).toBe(bytes);
  });

  it("preserves external state edits made after planning", async () => {
    const f = await fixture();
    const stateFile = f.config.deploy.upload.stateFile;
    const bytes = JSON.stringify({
      schemaVersion: 2,
      kind: "frontend-deploy-state",
      updatedAt: new Date(0).toISOString(),
      targets: {},
    });
    const failed = await failure(
      deployFrontendAssets({
        ...f,
        adapter: {
          name: "cloud",
          targetIdentity: "bucket",
          async upload() {
            await mkdir(path.dirname(stateFile), { recursive: true });
            await writeFile(stateFile, bytes);
            return { uploaded: true };
          },
        },
      }),
    );
    expect(failed.message).toContain("changed after planning");
    expect(failed.result.uploaded).toBe(2);
    expect(await readFile(stateFile, "utf8")).toBe(bytes);
  });
});

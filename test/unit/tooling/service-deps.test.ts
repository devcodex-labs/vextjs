import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeServiceDependencies } from "../../../src/tooling/diagnostics/service-deps.js";

async function writeProjectFile(
  rootDir: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = join(rootDir, relativePath);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

describe("analyzeServiceDependencies", () => {
  let projectRoot: string;

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("detects circular dependencies through app.services and this.app.services", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "vext-service-deps-"));

    await writeProjectFile(
      projectRoot,
      "package.json",
      JSON.stringify({ name: "service-deps", type: "module" }, null, 2),
    );
    await writeProjectFile(
      projectRoot,
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
          include: ["src/**/*.ts", "src/**/*.d.ts"],
        },
        null,
        2,
      ),
    );
    await writeProjectFile(
      projectRoot,
      "src/config/default.ts",
      "export default { port: 3000 }\n",
    );
    await writeProjectFile(
      projectRoot,
      "src/services/user.ts",
      `export default class UserService {
  constructor(private app: any) {}

  getPayment() {
    return this.app.services.payment.stripe;
  }
}
`,
    );
    await writeProjectFile(
      projectRoot,
      "src/services/payment/stripe.ts",
      `export default class StripeService {
  constructor(_app: any) {}

  useUser(app: any) {
    return app.services.user;
  }
}
`,
    );

    const report = await analyzeServiceDependencies(projectRoot);

    expect(report.diagnostics.some((item) => item.level === "error")).toBe(true);
    expect(report.diagnostics[0]?.message).toContain("user");
    expect(report.diagnostics[0]?.message).toContain("payment.stripe");
  });

  it("returns info diagnostic when no cycle is found", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "vext-service-deps-ok-"));

    await writeProjectFile(
      projectRoot,
      "package.json",
      JSON.stringify({ name: "service-deps-ok", type: "module" }, null, 2),
    );
    await writeProjectFile(
      projectRoot,
      "tsconfig.json",
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
          },
          include: ["src/**/*.ts", "src/**/*.d.ts"],
        },
        null,
        2,
      ),
    );
    await writeProjectFile(
      projectRoot,
      "src/config/default.ts",
      "export default { port: 3000 }\n",
    );
    await writeProjectFile(
      projectRoot,
      "src/services/user.ts",
      `export default class UserService {
  constructor(_app: any) {}
}
`,
    );
    await writeProjectFile(
      projectRoot,
      "src/services/payment/stripe.ts",
      `export default class StripeService {
  constructor(private app: any) {}

  getUser() {
    return this.app.services.user;
  }
}
`,
    );

    const report = await analyzeServiceDependencies(projectRoot);

    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]?.level).toBe("info");
  });
});


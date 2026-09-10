import { withProjectOwner } from "../../src/lib/project/owner.js";
import {
  withArtifactTransaction,
  type ArtifactCandidate,
} from "../../src/lib/project/artifact-transaction.js";
import {
  createFrontendSeoArtifacts,
  type WriteFrontendSeoArtifactsOptions,
} from "../../src/frontend/tooling/seo-artifact-writer.js";
import {
  createFrontendMediaArtifacts,
  type WriteFrontendMediaArtifactsOptions,
} from "../../src/frontend/tooling/media-artifact-writer.js";
import {
  createClientContractArtifacts,
  type WriteClientContractOptions,
} from "../../src/frontend/tooling/client-contract-writer.js";

/** 测试通过生产事务消费候选；不在产品中保留只有测试调用的独立writer。 */
async function commit<T>(
  rootDir: string,
  outDir: string,
  produce: () => Promise<{ result: T; files: ArtifactCandidate[] }>,
): Promise<T> {
  return withProjectOwner(rootDir, "build", [outDir], () =>
    withArtifactTransaction(
      { rootDir, outDir, producer: "frontend" },
      async (transaction) => {
        const plan = await produce();
        await transaction.commit(plan.files);
        return plan.result;
      },
    ),
  );
}

export const commitSeoCandidate = (options: WriteFrontendSeoArtifactsOptions) =>
  commit(options.rootDir, options.config.outDir, () =>
    createFrontendSeoArtifacts(options),
  );
export const commitMediaCandidate = (
  options: WriteFrontendMediaArtifactsOptions,
) =>
  commit(options.rootDir, options.config.outDir, () =>
    createFrontendMediaArtifacts(options),
  );
export const commitClientCandidate = (options: WriteClientContractOptions) =>
  commit(options.rootDir, options.outDir, () =>
    createClientContractArtifacts(options),
  );

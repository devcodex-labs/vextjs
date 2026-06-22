import type {
  VextFrontendDeployUploadAdapter,
  VextFrontendDeployUploadAdapterInput,
  VextFrontendDeployUploadAdapterResult,
} from "../../contract/types.js";

export function createMockDeployAdapter(): VextFrontendDeployUploadAdapter {
  return {
    name: "mock",
    async upload(
      input: VextFrontendDeployUploadAdapterInput,
    ): Promise<VextFrontendDeployUploadAdapterResult> {
      return {
        uploaded: !input.dryRun,
        url: `mock://${input.uploadKey}`,
      };
    },
  };
}

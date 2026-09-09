import {
  acquireProjectOwner,
  adoptProjectOwner,
  type ProjectOwner,
  type ProjectOwnerGrant,
} from "../../src/lib/project/owner.js";

let owner: ProjectOwner | undefined;
let sequence: Promise<unknown> = Promise.resolve();
process.on(
  "message",
  (message: {
    operation: string;
    rootDir?: string;
    grant?: ProjectOwnerGrant;
  }) => {
    sequence = sequence.then(async () => {
      try {
        if (message.operation === "initialize" && message.rootDir) {
          owner = message.grant
            ? await adoptProjectOwner(message.rootDir, message.grant)
            : await acquireProjectOwner(message.rootDir, "dev");
          await owner.reserveOutputs([".vext/dev"]);
          process.send?.({
            type: "ready",
            identity: owner.identity,
            grant: message.grant ? undefined : owner.createGrant(),
          });
        } else if (message.operation === "assert") {
          await owner?.assertActive();
          process.send?.({ type: "asserted" });
        } else if (message.operation === "release") {
          try {
            await owner?.release();
          } finally {
            process.exit(0);
          }
        }
      } catch (error) {
        process.send?.({
          type: "error",
          code: (error as { code?: string }).code,
          message: String(error),
        });
      }
    });
  },
);

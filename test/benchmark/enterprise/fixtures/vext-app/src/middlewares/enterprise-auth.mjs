import { auth, defineMiddleware } from "vextjs";
import { resolveBenchmarkIdentity } from "../../../../contract.mjs";
import { increment } from "../../../../target-runtime.mjs";
import { enterpriseState } from "../plugins/enterprise-runtime.mjs";

const authenticate = auth({
  verify(token) {
    return resolveBenchmarkIdentity(`Bearer ${token ?? ""}`, {
      onAuthorization: () => increment(enterpriseState, "authorization"),
    });
  },
});

export default defineMiddleware(async (req, res, next) => {
  if (!req.path.startsWith("/benchmark")) {
    increment(enterpriseState, "authentication");
  }
  await authenticate(req, res, next);
});

import { jwtVerify } from "jose";
import { auth, defineMiddleware } from "vextjs";
import {
  JWT_ALGORITHM,
  JWT_AUDIENCE,
  JWT_ISSUER,
  JWT_SECRET,
} from "../../../../contract.mjs";
import { benchmarkRuntime } from "../plugins/benchmark-runtime.mjs";

const key = new TextEncoder().encode(
  process.env.BENCHMARK_JWT_SECRET ?? JWT_SECRET,
);

export default defineMiddleware(
  auth({
    provider: "framework-native-benchmark",
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: [JWT_ALGORITHM],
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE,
        });
        const roles = Array.isArray(payload.roles)
          ? payload.roles.filter((entry) => typeof entry === "string")
          : [];
        return {
          subject: payload.sub,
          userId: payload.sub,
          roles,
          claims: { tenantId: payload.tenantId },
          can(action) {
            benchmarkRuntime.record("authorization");
            return action === "orders:write" && roles.includes("orders:write");
          },
        };
      } catch {
        return false;
      }
    },
  }),
);

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 测试文件 glob
    include: ["test/**/*.test.{ts,js}"],

    // 超时（单个测试）
    testTimeout: 10_000,

    // 并行执行（Service 单元测试可并行，集成测试按需串行）
    pool: "forks",

    // 环境
    env: {
      NODE_ENV: "test",
    },
  },
});

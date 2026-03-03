/**
 * hello-world 示例路由
 *
 * 使用 vextjs 包导出的 defineRoutes 定义路由。
 * 在 monorepo 内通过 node_modules/vextjs symlink 解析到框架根目录。
 */
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/", {}, async (_req, res) => {
    res.json({ message: "hello world" });
  });

  app.get("/health", {}, async (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });
});

/**
 * hello-world 示例路由
 *
 * 使用 vextjs 包导出的 defineRoutes 定义路由。
 * 在仓库内通过 package.json 的 file:../.. dependency 解析当前 vextjs。
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

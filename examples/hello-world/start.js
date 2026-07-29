/**
 * hello-world 示例 — 生产模式启动脚本
 *
 * 此脚本模拟真实用户项目中 `vext start` 的启动方式（生产模式）。
 * 在仓库内通过 package.json 的 file:../.. dependency 解析当前 vextjs。
 *
 * ─── 生产模式（当前文件） ───────────────────────────────
 *
 *   在实际用户项目中，应使用 CLI 命令启动：
 *
 *     npx vext start
 *     npx vext start --port 8080
 *
 *   或在代码中直接调用 bootstrap：
 *
 *     import { bootstrap } from 'vextjs'
 *     await bootstrap(__dirname)
 *
 * ─── 开发模式 ──────────────────────────────────────────
 *
 *   开发模式通过 CLI 命令启动，无需单独的启动脚本：
 *
 *     npx vext dev
 *     npx vext dev --poll              # Docker / NFS 环境
 *     npx vext dev --debounce 200      # 自定义防抖
 *     npx vext dev --no-hot            # 禁用热重载，所有变更走 Cold Restart
 *
 *   开发模式特性：
 *     - Tier 1 (代码修改)：Soft Reload — esbuild.transform() 热替换
 *     - Tier 2 (文件新增/删除)：Soft Reload — esbuild ctx.rebuild() 重建
 *     - Tier 3 (配置/插件/.env)：Cold Restart — 自动 kill + fork 重启子进程
 *     - 键盘快捷键：r=restart, h=reload, c=clear, ?=help, Ctrl+C=quit
 *
 *   详见 README.md 中的「开发模式」章节。
 */
import { bootstrap } from "vextjs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const result = await bootstrap(__dirname);
  console.log(
    `[hello-world] server started on http://${result.serverHandle.host}:${result.serverHandle.port}`,
  );
} catch (err) {
  console.error("[hello-world] failed to start:", err);
  process.exit(1);
}

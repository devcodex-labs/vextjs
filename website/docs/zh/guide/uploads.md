# 文件上传

内置 multipart 解析支持把上传文件读入 `req.files`，适合有明确大小上限的小文件。它不会自动保存文件，也不会创建临时目录。本文先完成一个可验证的接收流程，再说明路由覆盖与资源边界。

## 运行一个最小示例

前置条件：按[快速开始](/zh/guide/quick-start)准备 Node.js 20+ 的 TypeScript 应用，npm scripts 为 `dev: vext dev`、`build: vext build`、`start: vext start`。合并以下两个文件；本例关闭全局 multipart，只在上传路由开启。

```typescript
// src/config/default.ts
import type { VextUserConfig } from "vextjs";

export default {
  host: "127.0.0.1",
  port: 3000,
  adapter: "native",
  frontend: { enabled: false },
  bodyParser: { enabled: true, maxBodySize: "16kb" },
  multipart: { enabled: false },
} satisfies VextUserConfig;
```

```typescript
// src/routes/uploads.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.post(
    "/",
    {
      multipart: {
        enabled: true,
        maxFileSize: 1024,
        maxFiles: 1,
        allowedMimeTypes: ["text/plain"],
        files: { document: { description: "文本文件", required: true } },
      },
    },
    async (req, res) => {
      // 非 multipart 请求不会触发解析器的 required 检查，入口仍需检查。
      const file = req.files?.find((item) => item.fieldname === "document");
      if (!file) {
        return app.throw(400, "Expected document file");
      }
      res.json({
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
      });
    },
  );
});
```

在示例项目目录准备三个测试文件：5字节的 `sample.txt`、1025字节的 `oversized.txt` 和20KB的 `large.txt`。下面命令会写入这三个文件，已有同名文件时请改用其他名称：

```bash
node -e "const fs = require('node:fs'); fs.writeFileSync('sample.txt', 'hello'); fs.writeFileSync('oversized.txt', 'a'.repeat(1025)); fs.writeFileSync('large.txt', 'a'.repeat(20 * 1024));"
```

执行 `npm run dev`，以下请求对应示例的 `http://127.0.0.1:3000`。Windows PowerShell 可以使用 `curl.exe` 调用实际 curl。`curl -F` 自动生成 boundary，不要另写一个缺少 boundary 的 Content-Type：

```bash
curl -i -F "document=@sample.txt;type=text/plain" http://127.0.0.1:3000/uploads
curl -i -F "other=@sample.txt;type=text/plain" http://127.0.0.1:3000/uploads
curl -i -F "document=@sample.txt;type=application/octet-stream" http://127.0.0.1:3000/uploads
curl -i -H "Content-Type: application/json" -d '{}' http://127.0.0.1:3000/uploads
curl -i -F "document=@oversized.txt;type=text/plain" http://127.0.0.1:3000/uploads
curl -i -F "document=@sample.txt;type=text/plain" -F "document=@sample.txt;type=text/plain" http://127.0.0.1:3000/uploads
curl -i -F "document=@large.txt;type=text/plain" http://127.0.0.1:3000/uploads
```

| 请求                                          | 预期                                                       |
| --------------------------------------------- | ---------------------------------------------------------- |
| 第一次，文件不超过1024字节                    | HTTP 200，`data` 含 filename、size、mimetype；大小是字节数 |
| 字段名 other                                  | HTTP 400，缺少 document 文件字段                           |
| MIME 为 application/octet-stream              | HTTP 415                                                   |
| JSON 请求                                     | HTTP 400，由本例 handler 拒绝                              |
| document 文件超过1024字节，但整个请求小于16KB | HTTP 413，单文件超限                                       |
| 同一请求上传两个文件                          | HTTP 413，文件数量超限                                     |
| 整个请求超过16KB                              | HTTP 413，请求体超限                                       |

停止开发服务，执行 `npm run build -- --typecheck` 与 `npm start`，再复验上述请求。接收成功仅表示解析与校验完成。本例没有持久化文件；需要保存时，在应用服务中明确存储目的地、命名规则、失败处理与删除策略。

## 请求体与文件限制

| 配置                         | 默认值     | 作用                                                   |
| ---------------------------- | ---------- | ------------------------------------------------------ |
| `bodyParser.enabled`         | `true`     | 全局 body 解析开关                                     |
| `bodyParser.maxBodySize`     | `"1mb"`    | 整个请求体的读取上限；支持字节数字或 b/kb/mb/gb 字符串 |
| `multipart.enabled`          | `false`    | 全局内置 multipart 开关                                |
| `multipart.maxFileSize`      | `10485760` | 单文件字节上限，数值类型                               |
| `multipart.maxFiles`         | `10`       | 单次文件数上限                                         |
| `multipart.allowedMimeTypes` | 未设置     | 未设置时不按 MIME 限制                                 |

整个 multipart 请求还包含 boundary 和表单头等开销；`maxBodySize` 应大于计划接受的文件总量和必要开销。放大 `maxFileSize` 不会自动放大请求读取上限。adapter 自身若还有限额，有效读取上限取更严格的值，不能仅凭 multipart 配置保证大请求能进入应用。

## 路由覆盖的实际语义

- `multipart.enabled: true` 在全局关闭时仍可启用当前路由的解析；`false` 跳过当前路由内置 multipart；未设置时跟随全局。
- 路由专用解析中间件仅在路由显式 `enabled: true` 时注入。需要路由级 `files.required`、大小、数量或 MIME 校验时，应同时设置这个开关。
- 全局已经解析时，路由中间件对 `req.files` 二次检查。路由可以收紧限制，但全局提前拒绝的请求不会到达路由，因此不能通过更宽松的路由参数挽回。
- 需要不同路由独立限额时，可像示例一样关闭全局 multipart，在各路由显式开启。读取上限仍受 bodyParser 和 adapter 边界约束。
- 路由 `bodyParser.maxBodySize` 设置整个请求的上限；兼容入口 `override.maxBodySize` 仅在没有路由 `bodyParser` 对象时参与选择，不与该对象逐字段混合。
- `bodyParser.enabled: false` 只关闭该层解析，不等价于关闭显式注册的路由 multipart；若要交给自定义上传逻辑，应明确设置路由 `multipart.enabled: false`。

全局解析位于用户认证中间件之前；显式路由 multipart 也会插入当前路由用户中间件和 auth Guard 之前。因此，给上传路由配置 auth 不代表框架会先授权再读取文件。具体执行链见[路由定义 API](/zh/api/route-definition)。上传身份与对象权限仍需应用独立校验，解析开关不能替代授权。

## req.files 与表单字段

`req.files` 是可选的 `ParsedFile[]`；每项有 `fieldname`、`filename`、`mimetype`、`size` 和 `buffer: Buffer`。文件名字段是 `filename`，没有框架生成的磁盘路径。未启用、未命中 multipart 或未执行解析时可能为 undefined；解析成功但没有文件时可能为空数组。

`files` 配置用于描述字段和检查必传同名文件；它不是允许字段白名单。未声明的文件仍可上传，继续受通用大小、数量及 MIME 限制；`required: true` 也不代表只允许一个同名文件。

在 POST、PUT、PATCH 路由中，`files` 还会参与 OpenAPI 的 multipart requestBody 生成；字段描述和必传标记可以供 API 使用方阅读，但只写 files 不会自动注册路由解析器。示例明确设置 `multipart.enabled: true`，使实际接收行为与描述对应；完整规则见[路由定义 API](/zh/api/route-definition)。

内置解析只提取 File 条目，不把普通 multipart 文本字段写入 `req.body`。需要同时校验文本字段时，应采用明确支持该合同的自定义解析方式，不能直接假设 `req.valid("body")` 能得到这些文本字段。

`allowedMimeTypes` 比较的是解析后 File 的 MIME 值，不检测实际文件内容；File.type 为空时按 `application/octet-stream` 处理。未设置列表表示不限制，空数组则没有任何可接受的 MIME。需要可信格式时，由应用校验内容；原始 filename 也不应直接充当存储路径。

## 内存、adapter 与自定义上传

内置流程读取有上限的原始 Buffer，再用 Web API 解析表单，文件内容保存在 `ParsedFile.buffer`；各 adapter 共享该解析器，但各自还有请求读取边界。它不是流式持久化，多个并发上传可能占用多份请求和文件内存，不能把单文件限制当成进程总内存预算。

没有内置 `tmpDir`、磁盘保留 TTL 或定时清理任务。请求结束后也不会立即、显式清零所有 Buffer；不再被引用的内存由运行时回收。应用保存到磁盘或对象存储的内容、失败残留和连接生命周期由应用负责。

大文件、边读边写、断点续传或自定义表单语义，应按实际 adapter 和存储能力选择自定义上传方案，先关闭会消费请求体的内置解析。`_getRawBodyBuffer()` 仍会把内容读入内存，不是流式能力的替代。插件接入见[插件指南](/zh/guide/plugins)，资源归属见[安全与资源规范](/zh/specification/security-and-resources)。

## 错误与复验

内置解析失败直接返回 JSON，包含 `code`、`message`、`requestId`，没有成功响应的 `data` 包装。

| 症状                   | 判断与处理                                                    | 复验                                |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------- |
| req.files 为 undefined | 检查 Content-Type 的 boundary、全局与路由开关、解析是否被跳过 | 按示例发真实 multipart 请求         |
| 必传校验没触发         | 非 multipart 会跳过；路由是否显式 enabled:true                | 分别发缺文件 multipart 和 JSON      |
| 413                    | 区分请求体、单文件和数量上限；同时检查反向代理与 adapter      | 分别只超过一个限制                  |
| 415                    | 查看实际表单 MIME 是否在允许列表                              | 使用允许与不允许 MIME 各一次        |
| 400                    | boundary/报文格式或必传文件缺失                               | 用 curl -F 自动生成 boundary 后重试 |
| 找不到已上传文件       | 内置解析没有写盘                                              | 检查应用保存逻辑，并验证存储端结果  |

完整字段定义见[配置 API](/zh/api/config)、[请求上下文 API](/zh/api/context)及[路由定义 API](/zh/api/route-definition)。

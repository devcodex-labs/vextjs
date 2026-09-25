---
role: troubleshooting
---

# 错误处理

本页用于定位路由和中间件的失败。先确认 HTTP 状态码、响应体、请求的 Accept 和 requestId，再区分输入校验、业务拒绝、认证和未知异常。沿请求调用链抛出或 await 到的错误会交给框架处理；脱离调用链的后台 Promise 或定时器错误不能假定会变成当前请求的响应。

路由处理与校验的职责边界见 [HTTP 与路由规范](/zh/specification/http-and-routing)。

## 按症状定位

| 症状                                   | 优先检查                                                                        | 处理后如何验证                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 启动报路由定义、前缀冲突或中间件不存在 | 默认导出、同步工厂、入口前缀、配置白名单                                        | 重启成功，再请求该方法和完整路径                                         |
| 路由返回 404                           | 文件前缀是否重复写入、HTTP 方法是否匹配、入口是否被排除；或业务是否主动抛出 404 | 先用路由指南的最小示例验证加载，再区分框架 Not Found 与业务 message/code |
| 400 / 422 且包含 errors                | `validate` 的位置及字段、请求体格式、Content-Type                               | 错误输入仍失败，改为满足 schema 的输入后进入 handler                     |
| 401 / 403 且为 AUTH\_\*                | 认证中间件是否建立 req.auth；auth 的角色/权限要求                               | 缺失凭据仍被拒绝，合法且具备权限的凭据成功                               |
| 500 / Internal Server Error            | 用 requestId 关联服务端日志，检查异常传播链                                     | 根因修复后请求成功；未预期错误仍被记录                                   |
| 浏览器显示 HTML，接口工具显示 JSON     | Accept、dev overlay、页面错误渲染                                               | 显式 Accept: application/json 后检查 JSON 合同                           |
| code 与 HTTP status 不同               | 是否传入业务码或由语言包配置业务码                                              | 分别断言 HTTP 状态与业务 code，不能混用                                  |

路由声明问题见 [路由指南](/zh/guide/routing)，白名单问题见 [中间件指南](/zh/guide/middleware#注册与使用)，AUTH\_\* 含义见 [auth 参考](/zh/api/route-definition#auth)。

## 最小复现与验证

在可启动的 VextJS 项目中新建以下文件；尚未建项目时先完成 [快速开始](/zh/guide/quick-start)。该例不需要 service 或数据库；以默认 `response.hideInternalErrors: true` 及 JSON 请求验证。

```ts
// src/routes/error-demo.ts
import { defineRoutes } from "vextjs";

export default defineRoutes((app) => {
  app.get("/missing", (_req, _res) => {
    app.throw({
      status: 404,
      message: "Item not found",
      code: "ITEM_NOT_FOUND",
      details: { itemId: "example" },
    });
  });
  app.get(
    "/item/:id",
    { validate: { param: { id: "integer:1-!" } } },
    (req, res) => {
      res.json(req.valid("param"));
    },
  );
  app.post("/", { validate: { body: { email: "email!" } } }, (req, res) => {
    res.json(req.valid("body"));
  });
  app.get("/unknown", () => {
    throw new Error("Example internal failure");
  });
});
```

在项目根目录创建两个 UTF-8 请求文件：`error-invalid.json` 内容为 `{}`，`error-valid.json` 内容如下：

```json
{ "email": "a@example.com" }
```

运行 `npm run dev`，在另一个终端发送下列请求。假设地址为 `http://127.0.0.1:3000`，统一设置 `Accept: application/json`；Windows PowerShell 使用 `curl.exe` 调用实际 curl。

```bash
curl -i -H "Accept: application/json" http://127.0.0.1:3000/error-demo/missing
curl -i -H "Accept: application/json" http://127.0.0.1:3000/error-demo/item/abc
curl -i -H "Accept: application/json" http://127.0.0.1:3000/error-demo/item/1
curl -i -H "Accept: application/json" -H "Content-Type: application/json" --data-binary @error-invalid.json http://127.0.0.1:3000/error-demo
curl -i -H "Accept: application/json" -H "Content-Type: application/json" --data-binary @error-valid.json http://127.0.0.1:3000/error-demo
curl -i -H "Accept: application/json" http://127.0.0.1:3000/error-demo/unknown
```

逐条核对以下结果：

| 请求                                                 | 应观察到的结果                                                |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| GET `/error-demo/missing`                            | HTTP 404，code 为 ITEM_NOT_FOUND，details.itemId 为 example   |
| GET `/error-demo/item/abc`                           | HTTP 400，errors 包含 id 字段                                 |
| GET `/error-demo/item/1`                             | HTTP 200，默认包装后的 data.id 为数字 1                       |
| POST `/error-demo`，JSON `{}`                        | HTTP 422，errors 包含 email 字段                              |
| POST `/error-demo`，JSON `{"email":"a@example.com"}` | HTTP 200                                                      |
| GET `/error-demo/unknown`                            | 默认 HTTP 500，message 为 Internal Server Error，不包含 stack |

POST 同时设置 `Content-Type: application/json`。若结果不同，先对比项目的 response 配置、validator、错误 hook 和中间件，再比较业务代码；不要通过关闭校验或吞掉异常来让用例变绿。

## `app.throw`

**问题：预期业务拒绝却返回 500，或业务 code 丢失。** 检查是否用了普通 `new Error()`，以及是否把业务码误当 HTTP status。需要指定状态、业务码或 details 时使用以下结构化入口；修复后分别检查 HTTP status 与响应体 code。

`app.throw` 适合“我要主动返回明确 HTTP 错误”的场景，例如 401、404、409、502，或需要业务码、i18n 参数、三方错误详情的响应。

```ts
// 基本错误
app.throw(404, "user.not_found");

// 业务错误码
app.throw(409, "email.taken", "EMAIL_TAKEN");

// i18n 插值参数 + 业务错误码
app.throw(400, "balance.insufficient", { balance: 50 }, 20001);

// 第四参数为对象或数组时，作为 details 输出
app.throw(
  502,
  "payment.failed",
  { orderId },
  {
    provider: "stripe",
    providerCode: "card_declined",
  },
);

// 同时需要 code + details 时，使用对象式入口
app.throw({
  status: 502,
  message: "payment.failed",
  code: "PAYMENT_FAILED",
  details: { provider: "stripe", providerCode: "card_declined" },
});
```

`app.throw()` 返回类型是 `never`，调用后会中断当前处理流程，不需要额外 `return`。

## `details`

**问题：三方错误详情没有出现在响应中。** 默认不会把三方错误对象的全部属性作为响应正文；检查是否明确提供了 `details`，以及清洗后是否还有可序列化内容。

`details` 用来显式返回业务详情，常见于三方接口或下游服务错误：

- 上游业务码、原始 message、trace id
- 可展示给调用方的失败原因
- 业务方自行裁剪后的三方响应片段

框架会在写出响应前做 JSON-safe 清洗：循环或重复对象引用会变成 `"[Circular]"`，`Date` 输出 ISO 字符串，`Error` 只输出 `name/message`。对象中的函数和 `undefined` 属性会省略；在数组中则保留位置并替换为 `null`。深度达到 8 的对象会截断为 `"[MaxDepth]"`，BigInt 会转为字符串。

顶层标量会包装为 `{ value: ... }`；空对象、空数组及无法保留任何值的 details 会省略。因此响应中的 details 不保证与传入对象完全同形。

推荐通过 `HttpError` 或 `app.throw` 明确传入 details。错误归一化也会读取异常上显式附加的 `details` 字段并清洗，因此不能把 `hideInternalErrors` 当作任意自定义详情的过滤器；不要把整个三方异常直接当成允许公开的详情。

## 响应格式

```json
{
  "code": "PAYMENT_FAILED",
  "message": "支付失败",
  "details": {
    "provider": "stripe",
    "providerCode": "card_declined"
  },
  "requestId": "550e8400-e29b-41d4-a716-446655440000"
}
```

`code` 优先使用显式业务码，其次可能来自 i18n 配置；没有业务码时回退为 HTTP status。HTTP status 与 body.code 是两个字段。

## 与普通 Error 的区别

**问题：只看到 500，或浏览器与 curl 返回格式不同。** 普通 `new Error()` 默认进入 500；归一化也会读取错误上的 `status` / `statusCode`。使用明确的 HTTP 错误入口能避免依赖三方异常形状。

```ts
// 结构化业务错误：返回指定 status/message/code/details
app.throw(404, "user.not_found");

// 未预期运行时错误：进入 500 路径
throw new Error("Database connection lost");
```

`response.hideInternalErrors` 默认 true，会隐藏未知 5xx 的内部消息和 stack；本地确需查看 JSON stack 时可以设置 false。显式结构化错误按自身合同输出。浏览器 Accept 包含 `text/html` 时，开发覆盖层或页面错误渲染可能返回 HTML；排查 JSON API 时明确请求 `application/json`。

服务端默认记录未知异常和 HttpError 5xx；校验错误不记录，HttpError 4xx 需 `response.logErrors.http4xx: true` 才记录。若日志缺失，检查 logger、logErrors 和错误是否被自定义中间件捕获后吞掉；只做日志上报的 catch 应重新抛出原错误。

## 校验错误

**问题：相似输入有时返回 400、有时返回 422。** 先看校验位置：路径参数使用 400，其他声明位置使用 422。不要只按“数据不合法”把两者合并。检查原始输入、schema 与 `errors[].field`，修复请求后重试。

路由 `validate` 失败时，非法路径参数返回 HTTP `400`，query、header、cookie 与 body 失败返回 HTTP `422`，两者都包含字段级错误详情。自定义字段级错误可以抛出 `VextValidationError`：

```ts
import { VextValidationError } from "vextjs";

throw new VextValidationError([{ field: "email", message: "Invalid email" }]);
```

## 更多参考

- [`app.throw` API](/zh/api/app#appthrowstatus-message-paramsorcode-codeordetails)
- [中间件中的错误处理](/zh/guide/middleware#错误处理中间件)
- [路由中的错误处理](/zh/guide/routing#错误处理)
- [响应配置](/zh/guide/configuration#响应配置-response)
- [HTTP 与路由规范](/zh/specification/http-and-routing)

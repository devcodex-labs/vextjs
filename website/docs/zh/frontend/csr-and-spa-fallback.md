# CSR 与 SPA Fallback

Vext 默认页面模型是 SSR + hydration。CSR fallback 必须显式、范围化配置。

## 什么时候使用 CSR

当某个路径范围在首个 shell 后由浏览器应用接管时，可以使用 client-router 子应用：

- 后台工作台
- 编辑器或仪表盘工具
- 内嵌产品控制台
- 某个 path prefix 下的复杂客户端导航

普通内容页仍然建议 SSR。

## 配置 Scope

```ts
export default {
  frontend: {
    spaFallback: {
      scopes: [
        {
          basePath: "/app",
          page: "app/shell",
          ssr: false,
          exclude: ["/app/api/**"],
        },
      ],
    },
  },
};
```

`scopes[]` 默认是空数组。不显式配置，就不会 fallback。

## 请求匹配

只有同时满足以下条件才 fallback：

- 请求路径位于某个 scope 内
- 没有显式 API 或 route 处理该请求
- 没有匹配静态资源
- 请求接受 HTML
- scope exclude 未命中

JSON 和 API 请求仍保持原有 404 / 错误语义。

## 混合 SSR 与 CSR

一个项目可以同时使用：

```text
/             -> SSR page
/pricing      -> SSR page
/admin        -> SSR entry
/admin/app/*  -> scoped CSR shell
/api/**       -> API routes
```

关键规则是每个 client-router 区域都有明确 base path 和 shell page。

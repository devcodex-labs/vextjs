/**
 * operation-id.ts — OperationId 自动推断工具
 *
 * 从 HTTP 方法和路由路径自动推断 OpenAPI operationId。
 * 用户可在 docs.operationId 中覆盖自动推断的值。
 *
 * 推断规则：
 *   1. HTTP 方法映射为动词前缀：GET→get, POST→create, PUT→update, PATCH→patch, DELETE→delete
 *   2. 路径段转为 PascalCase 拼接：/users/:id/roles → UsersById Roles
 *   3. 动态参数 :param 转为 ByParam：:id → ById
 *   4. 通配符 *param 直接转为 Param：*path → Path
 *
 * 示例：
 *   GET    /users          → 'getUsers'
 *   POST   /users          → 'createUsers'
 *   GET    /users/:id      → 'getUsersById'
 *   PUT    /users/:id      → 'updateUsersById'
 *   DELETE /users/:id      → 'deleteUsersById'
 *   GET    /users/list     → 'getUsersList'
 *   POST   /users/:id/roles → 'createUsersByIdRoles'
 *   GET    /admin/dashboard → 'getAdminDashboard'
 *
 * @module lib/openapi/operation-id
 * @see 14-openapi.md §6（OperationId 自动推断）
 */

/**
 * HTTP 方法到动词前缀的映射
 *
 * 基于 RESTful 语义，将 HTTP 方法映射为有意义的动词前缀。
 * 未知方法使用小写方法名作为前缀。
 */
const METHOD_PREFIX_MAP: Record<string, string> = {
  GET: "get",
  POST: "create",
  PUT: "update",
  PATCH: "patch",
  DELETE: "delete",
  HEAD: "head",
  OPTIONS: "options",
};

/**
 * 从 HTTP 方法和路径推断 operationId
 *
 * 生成规则：
 *   1. 从 METHOD_PREFIX_MAP 获取方法前缀（未知方法使用小写方法名）
 *   2. 移除路径前导斜杠
 *   3. 将 `:param` 替换为 `ByParam`（动态路径参数）
 *   4. 将 `*param` 替换为 `param`（通配符参数）
 *   5. 按 `/` 分割为段
 *   6. 每段首字母大写后拼接
 *   7. 前缀 + 路径部分 = operationId
 *
 * @param method HTTP 方法（大写或小写均可，内部统一为大写）
 * @param path   完整路由路径（如 /users/:id/roles）
 * @returns 推断的 operationId（如 'createUsersByIdRoles'）
 *
 * @example
 * ```typescript
 * inferOperationId('GET', '/users')           // → 'getUsers'
 * inferOperationId('POST', '/users')          // → 'createUsers'
 * inferOperationId('GET', '/users/:id')       // → 'getUsersById'
 * inferOperationId('PUT', '/users/:id')       // → 'updateUsersById'
 * inferOperationId('DELETE', '/users/:id')    // → 'deleteUsersById'
 * inferOperationId('GET', '/users/list')      // → 'getUsersList'
 * inferOperationId('POST', '/users/:id/roles') // → 'createUsersByIdRoles'
 * inferOperationId('GET', '/admin/dashboard') // → 'getAdminDashboard'
 * inferOperationId('GET', '/files/*path')     // → 'getFilesPath'
 * inferOperationId('GET', '/')                // → 'getRoot'
 * ```
 */
export function inferOperationId(method: string, path: string): string {
  // ── 1. 获取方法前缀 ──────────────────────────────────────
  const prefix =
    METHOD_PREFIX_MAP[method.toUpperCase()] ?? method.toLowerCase();

  // ── 2. 路径转换 ──────────────────────────────────────────
  const pathPart = path
    .replace(/^\//, "") // 移除前导斜杠
    .replace(/\//g, "-") // 斜杠转连字符（用于后续 split）
    .replace(
      /:(\w+)/g,
      (_match, p1: string) => `By${p1.charAt(0).toUpperCase()}${p1.slice(1)}`,
    ) // :id → ById, :userId → ByUserId
    .replace(/\*(\w+)/g, "$1") // *path → path
    .split("-")
    .filter((segment) => segment.length > 0) // 过滤空段
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");

  // ── 3. 空路径（根路由 /）处理 ────────────────────────────
  if (pathPart === "") {
    return `${prefix}Root`;
  }

  return prefix + pathPart;
}

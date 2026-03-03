import { describe, it, expect } from "vitest";
import { inferOperationId } from "../../../src/lib/openapi/operation-id.js";

// ═════════════════════════════════════════════════════════════
// inferOperationId 单元测试
// ═════════════════════════════════════════════════════════════

describe("inferOperationId", () => {
  // ── 基础 HTTP 方法前缀映射 ────────────────────────────────

  describe("HTTP 方法前缀映射", () => {
    it("GET → 'get' 前缀", () => {
      expect(inferOperationId("GET", "/users")).toBe("getUsers");
    });

    it("POST → 'create' 前缀", () => {
      expect(inferOperationId("POST", "/users")).toBe("createUsers");
    });

    it("PUT → 'update' 前缀", () => {
      expect(inferOperationId("PUT", "/users")).toBe("updateUsers");
    });

    it("PATCH → 'patch' 前缀", () => {
      expect(inferOperationId("PATCH", "/users")).toBe("patchUsers");
    });

    it("DELETE → 'delete' 前缀", () => {
      expect(inferOperationId("DELETE", "/users")).toBe("deleteUsers");
    });

    it("HEAD → 'head' 前缀", () => {
      expect(inferOperationId("HEAD", "/users")).toBe("headUsers");
    });

    it("OPTIONS → 'options' 前缀", () => {
      expect(inferOperationId("OPTIONS", "/users")).toBe("optionsUsers");
    });

    it("未知方法 → 小写方法名作为前缀", () => {
      expect(inferOperationId("PURGE", "/cache")).toBe("purgeCache");
    });
  });

  // ── 方法大小写处理 ────────────────────────────────────────

  describe("方法大小写处理", () => {
    it("小写方法名应正确转换", () => {
      expect(inferOperationId("get", "/users")).toBe("getUsers");
    });

    it("混合大小写方法名应正确转换", () => {
      expect(inferOperationId("Get", "/users")).toBe("getUsers");
    });

    it("小写 post 应映射为 create 前缀", () => {
      expect(inferOperationId("post", "/users")).toBe("createUsers");
    });

    it("小写 delete 应映射为 delete 前缀", () => {
      expect(inferOperationId("delete", "/users")).toBe("deleteUsers");
    });
  });

  // ── 简单路径转换 ──────────────────────────────────────────

  describe("简单路径转换", () => {
    it("/users → 'Users'", () => {
      expect(inferOperationId("GET", "/users")).toBe("getUsers");
    });

    it("/users/list → 'UsersList'", () => {
      expect(inferOperationId("GET", "/users/list")).toBe("getUsersList");
    });

    it("/admin/dashboard → 'AdminDashboard'", () => {
      expect(inferOperationId("GET", "/admin/dashboard")).toBe(
        "getAdminDashboard",
      );
    });

    it("/api/v1/users → 'ApiV1Users'", () => {
      expect(inferOperationId("GET", "/api/v1/users")).toBe("getApiV1Users");
    });

    it("单段路径 /health → 'Health'", () => {
      expect(inferOperationId("GET", "/health")).toBe("getHealth");
    });

    it("多段路径 /a/b/c/d → 'ABCD'（每段首字母大写）", () => {
      expect(inferOperationId("GET", "/a/b/c/d")).toBe("getABCD");
    });
  });

  // ── 动态参数 (:param → ByParam) ───────────────────────────

  describe("动态参数 (:param → ByParam)", () => {
    it("/users/:id → 'getUsersById'", () => {
      expect(inferOperationId("GET", "/users/:id")).toBe("getUsersById");
    });

    it("PUT /users/:id → 'updateUsersById'", () => {
      expect(inferOperationId("PUT", "/users/:id")).toBe("updateUsersById");
    });

    it("DELETE /users/:id → 'deleteUsersById'", () => {
      expect(inferOperationId("DELETE", "/users/:id")).toBe("deleteUsersById");
    });

    it("/users/:userId/posts/:postId → 'getUsersByUserIdPostsByPostId'", () => {
      expect(inferOperationId("GET", "/users/:userId/posts/:postId")).toBe(
        "getUsersByUserIdPostsByPostId",
      );
    });

    it("POST /users/:id/roles → 'createUsersByIdRoles'", () => {
      expect(inferOperationId("POST", "/users/:id/roles")).toBe(
        "createUsersByIdRoles",
      );
    });

    it("/orders/:orderId/items/:itemId → 多个动态参数", () => {
      expect(
        inferOperationId("GET", "/orders/:orderId/items/:itemId"),
      ).toBe("getOrdersByOrderIdItemsByItemId");
    });

    it("/posts/:id/comments → 嵌套资源", () => {
      expect(inferOperationId("GET", "/posts/:id/comments")).toBe(
        "getPostsByIdComments",
      );
    });
  });

  // ── 通配符参数 (*param → param) ───────────────────────────

  describe("通配符参数 (*param → param)", () => {
    it("/files/*path → 'getFilesPath'", () => {
      expect(inferOperationId("GET", "/files/*path")).toBe("getFilesPath");
    });

    it("/static/*filepath → 'getStaticFilepath'", () => {
      expect(inferOperationId("GET", "/static/*filepath")).toBe(
        "getStaticFilepath",
      );
    });

    it("/proxy/*url → 'getProxyUrl'", () => {
      expect(inferOperationId("GET", "/proxy/*url")).toBe("getProxyUrl");
    });
  });

  // ── 根路由 (/) ────────────────────────────────────────────

  describe("根路由 (/)", () => {
    it("GET / → 'getRoot'", () => {
      expect(inferOperationId("GET", "/")).toBe("getRoot");
    });

    it("POST / → 'createRoot'", () => {
      expect(inferOperationId("POST", "/")).toBe("createRoot");
    });

    it("DELETE / → 'deleteRoot'", () => {
      expect(inferOperationId("DELETE", "/")).toBe("deleteRoot");
    });
  });

  // ── 首字母大写（PascalCase 拼接）──────────────────────────

  describe("首字母大写（PascalCase 拼接）", () => {
    it("多段路径每段首字母大写", () => {
      expect(inferOperationId("GET", "/user/profile/settings")).toBe(
        "getUserProfileSettings",
      );
    });

    it("已大写的段保持不变", () => {
      expect(inferOperationId("GET", "/API/Users")).toBe("getAPIUsers");
    });

    it("单字符段正确处理", () => {
      expect(inferOperationId("GET", "/a")).toBe("getA");
    });

    it("段内有数字", () => {
      expect(inferOperationId("GET", "/v2/users")).toBe("getV2Users");
    });
  });

  // ── 设计文档示例完整覆盖 ──────────────────────────────────

  describe("设计文档示例完整覆盖", () => {
    it("GET    /users          → 'getUsers'", () => {
      expect(inferOperationId("GET", "/users")).toBe("getUsers");
    });

    it("POST   /users          → 'createUsers'", () => {
      expect(inferOperationId("POST", "/users")).toBe("createUsers");
    });

    it("GET    /users/:id      → 'getUsersById'", () => {
      expect(inferOperationId("GET", "/users/:id")).toBe("getUsersById");
    });

    it("PUT    /users/:id      → 'updateUsersById'", () => {
      expect(inferOperationId("PUT", "/users/:id")).toBe("updateUsersById");
    });

    it("DELETE /users/:id      → 'deleteUsersById'", () => {
      expect(inferOperationId("DELETE", "/users/:id")).toBe("deleteUsersById");
    });

    it("GET    /users/list     → 'getUsersList'", () => {
      expect(inferOperationId("GET", "/users/list")).toBe("getUsersList");
    });

    it("POST   /users/:id/roles → 'createUsersByIdRoles'", () => {
      expect(inferOperationId("POST", "/users/:id/roles")).toBe(
        "createUsersByIdRoles",
      );
    });

    it("GET    /admin/dashboard → 'getAdminDashboard'", () => {
      expect(inferOperationId("GET", "/admin/dashboard")).toBe(
        "getAdminDashboard",
      );
    });

    it("GET    /files/*path    → 'getFilesPath'", () => {
      expect(inferOperationId("GET", "/files/*path")).toBe("getFilesPath");
    });

    it("GET    /               → 'getRoot'", () => {
      expect(inferOperationId("GET", "/")).toBe("getRoot");
    });
  });

  // ── 混合场景 ──────────────────────────────────────────────

  describe("混合场景", () => {
    it("动态参数 + 静态段 + 通配符混合", () => {
      expect(inferOperationId("GET", "/api/:version/files/*path")).toBe(
        "getApiByVersionFilesPath",
      );
    });

    it("连续动态参数", () => {
      expect(inferOperationId("GET", "/:org/:repo/issues")).toBe(
        "getByOrgByRepoIssues",
      );
    });

    it("尾部斜杠（trailing slash）不影响结果", () => {
      // 路径 /users/ 中最后一个空段被 filter 过滤
      const result = inferOperationId("GET", "/users/");
      expect(result).toBe("getUsers");
    });

    it("多层级 RESTful 嵌套资源", () => {
      expect(
        inferOperationId("PATCH", "/organizations/:orgId/teams/:teamId/members/:memberId"),
      ).toBe("patchOrganizationsByOrgIdTeamsByTeamIdMembersByMemberId");
    });

    it("API 版本前缀", () => {
      expect(inferOperationId("POST", "/api/v2/products")).toBe(
        "createApiV2Products",
      );
    });
  });

  // ── 边界场景 ──────────────────────────────────────────────

  describe("边界场景", () => {
    it("无前导斜杠的路径", () => {
      // 虽然不规范，但函数应能处理
      expect(inferOperationId("GET", "users")).toBe("getUsers");
    });

    it("双斜杠路径（空段被过滤）", () => {
      const result = inferOperationId("GET", "/users//list");
      expect(result).toBe("getUsersList");
    });

    it("路径只有动态参数 /:id", () => {
      expect(inferOperationId("GET", "/:id")).toBe("getById");
    });

    it("路径只有通配符 /*path", () => {
      expect(inferOperationId("GET", "/*path")).toBe("getPath");
    });

    it("长路径名", () => {
      expect(
        inferOperationId("GET", "/very/long/path/with/many/segments"),
      ).toBe("getVeryLongPathWithManySegments");
    });

    it("路径段含有数字和字母混合", () => {
      expect(inferOperationId("GET", "/v3beta1/models")).toBe(
        "getV3beta1Models",
      );
    });

    it("路径段含下划线（视为单个段）", () => {
      expect(inferOperationId("GET", "/user_profiles")).toBe(
        "getUser_profiles",
      );
    });

    it("路径段含连字符（不应出现在正常路由中，但应安全处理）", () => {
      // 连字符在 replace(/\//g, '-') 后与原有连字符合并
      // 结果取决于具体实现
      const result = inferOperationId("GET", "/health-check");
      expect(typeof result).toBe("string");
      expect(result.startsWith("get")).toBe(true);
    });
  });

  // ── 唯一性验证 ────────────────────────────────────────────

  describe("唯一性验证", () => {
    it("不同方法 + 相同路径 → 不同 operationId", () => {
      const getId = inferOperationId("GET", "/users");
      const postId = inferOperationId("POST", "/users");
      const putId = inferOperationId("PUT", "/users");
      const deleteId = inferOperationId("DELETE", "/users");

      const ids = new Set([getId, postId, putId, deleteId]);
      expect(ids.size).toBe(4);
    });

    it("相同方法 + 不同路径 → 不同 operationId", () => {
      const id1 = inferOperationId("GET", "/users");
      const id2 = inferOperationId("GET", "/posts");
      const id3 = inferOperationId("GET", "/comments");

      const ids = new Set([id1, id2, id3]);
      expect(ids.size).toBe(3);
    });

    it("相似路径不应冲突", () => {
      const id1 = inferOperationId("GET", "/users/:id");
      const id2 = inferOperationId("GET", "/users/list");
      const id3 = inferOperationId("GET", "/users/search");

      const ids = new Set([id1, id2, id3]);
      expect(ids.size).toBe(3);
    });

    it("嵌套资源不应冲突", () => {
      const id1 = inferOperationId("GET", "/users/:id/posts");
      const id2 = inferOperationId("GET", "/users/:id/comments");
      const id3 = inferOperationId("POST", "/users/:id/posts");

      const ids = new Set([id1, id2, id3]);
      expect(ids.size).toBe(3);
    });
  });

  // ── 返回值格式 ────────────────────────────────────────────

  describe("返回值格式", () => {
    it("返回值是字符串", () => {
      const result = inferOperationId("GET", "/users");
      expect(typeof result).toBe("string");
    });

    it("返回值以小写前缀开头（camelCase 风格）", () => {
      const result = inferOperationId("GET", "/users");
      expect(result[0]).toBe("g"); // 'get' 的首字母
      expect(result).toMatch(/^[a-z]/);
    });

    it("返回值不包含斜杠", () => {
      const result = inferOperationId("GET", "/api/v1/users/:id");
      expect(result).not.toContain("/");
    });

    it("返回值不包含冒号", () => {
      const result = inferOperationId("GET", "/users/:id");
      expect(result).not.toContain(":");
    });

    it("返回值不包含星号", () => {
      const result = inferOperationId("GET", "/files/*path");
      expect(result).not.toContain("*");
    });

    it("返回值不包含花括号", () => {
      const result = inferOperationId("GET", "/users/:id");
      expect(result).not.toContain("{");
      expect(result).not.toContain("}");
    });
  });
});

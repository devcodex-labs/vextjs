import { createHash } from "node:crypto";

/** 调用者传入已经解析的真实根；运行信息与源码检查共享同一项目身份。 */
export function projectIdentityDigest(
  rootDir: string,
  packageName: string | null,
): string {
  return createHash("sha256")
    .update(`${rootDir}\n${packageName ?? ""}`)
    .digest("hex");
}

import { createHash } from "node:crypto";

/**
 * 计算 buffer 的 sha256 hex 值。
 * 服务端上传 / Worker / 迁移脚本共用的核心 hash 工具。
 */
export function sha256Hex(input: Buffer | Uint8Array | ArrayBuffer): string {
  const buffer =
    Buffer.isBuffer(input)
      ? input
      : input instanceof Uint8Array
        ? Buffer.from(input)
        : Buffer.from(input);
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * 在浏览器侧用 Web Crypto API 计算文件 hash。
 * 用途：客户端先算 hash 携带给服务端，服务端会重算作为权威值。
 * 仅作快速命中优化（Hint），不作为唯一信任来源。
 */
export async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

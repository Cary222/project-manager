/**
 * API Key 加密层
 * - 使用 AES-256-GCM 进行对称加密
 * - ENCRYPTION_KEY: 32字节 hex 编码（64个字符）
 * - IV: 12 字节随机数（每次加密生成）
 * - AuthTag: 16 字节认证标签（自动由 OpenSSL crypto 生成）
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 12 字节，GCM 推荐
const KEY_LENGTH = 32; // 256 位

function getEncryptionKey(): Buffer {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error("ENCRYPTION_KEY environment variable is not set");
  }
  if (keyHex.length !== KEY_LENGTH * 2) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes)`
    );
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * 加密 API Key
 * @param plaintext - 明文 API Key
 * @returns { encryptedKey, iv, authTag } - 均为 hex 编码字符串
 */
export function encrypt(plaintext: string): {
  encryptedKey: string;
  iv: string;
  authTag: string;
} {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return {
    encryptedKey: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * 解密 API Key
 * @param encryptedKey - hex 编码的密文
 * @param iv - hex 编码的初始化向量
 * @param authTag - hex 编码的认证标签
 * @returns 明文 API Key
 */
export function decrypt(
  encryptedKey: string,
  iv: string,
  authTag: string
): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex")
  );

  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * 计算 API Key 的 SHA-256 hash（用于去重和快速比对）
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

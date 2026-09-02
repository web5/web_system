import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;
const DERIVE_SALT = 'deploy-console-config';

/** 密钥对外统一显示的掩码（页面与接口都只返回这个，绝不回显明文） */
export const SECRET_MASK = '••••••••';

/** 审计日志中对密钥值的占位符：审计只记录"改了哪个键"，明永不入审计 */
export const SECRET_UNRECORDED = '<密钥·不记录>';

let cachedKey: Buffer | null = null;

/**
 * 主密钥：来自环境变量 `CONFIG_MASTER_KEY`，**服务侧持有，不进代码库、不进数据库**。
 * 支持三种形态：base64 / 64 位 hex / 任意字符串（用 scrypt 派生为 32 字节）。
 */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.CONFIG_MASTER_KEY;
  if (!raw) {
    throw new Error('缺少 CONFIG_MASTER_KEY 环境变量，无法读写密钥配置');
  }
  let key: Buffer;
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    key = Buffer.from(raw, 'base64');
  } else if (/^[0-9a-fA-F]{64}$/i.test(raw)) {
    key = Buffer.from(raw, 'hex');
  } else {
    key = scryptSync(raw, DERIVE_SALT, KEY_LEN);
  }
  if (key.length !== KEY_LEN) {
    throw new Error(`CONFIG_MASTER_KEY 派生结果须为 ${KEY_LEN} 字节，实际 ${key.length}`);
  }
  cachedKey = key;
  return key;
}

/** 仅测试用：清除主密钥缓存 */
export function resetMasterKeyCache(): void {
  cachedKey = null;
}

/** 加密，输出 `iv:authTag:ciphertext`（均为 base64） */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    enc.toString('base64'),
  ].join(':');
}

/** 解密；密文被篡改会抛错（GCM 认证失败），可据此发现数据被非法改动 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('密钥密文格式非法（应为 iv:tag:data）');
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

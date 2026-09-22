import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';
import { existsSync, readFileSync } from 'fs';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY_LEN = 32;
const DERIVE_SALT = 'deploy-console-config';

/** 主密钥文件默认位置（`CONFIG_MASTER_KEY_FILE` 可覆盖） */
export const DEFAULT_MASTER_KEY_FILE = '/etc/web-system/config-master.key';

/** 密钥对外统一显示的掩码（页面与接口都只返回这个，绝不回显明文） */
export const SECRET_MASK = '••••••••';

/** 审计日志中对密钥值的占位符：审计只记录"改了哪个键"，明永不入审计 */
export const SECRET_UNRECORDED = '<密钥·不记录>';

/** 主密钥来源：env 值 / 文件（两者同时存在时会做一致性校验） */
export type MasterKeySource = 'env' | 'file' | 'env+file';

let cachedKey: Buffer | null = null;
let cachedSource: { source: MasterKeySource; filePath?: string } | null = null;

/** 出问题时给可执行指引（K3：启动即失败且能照着修） */
const FIX_HINT =
  '修复：把主密钥写入密钥文件并收紧权限，或临时用 CONFIG_MASTER_KEY 注入；' +
  '步骤见 specs/config-master-key-distribution/design.md §5.1 与 domain-split-guide.md';

/** 三种形态（base64 / 64 位 hex / 任意字符串 scrypt 派生）→ 32 字节密钥 */
function deriveKey(raw: string, label: string): Buffer {
  const value = raw.trim();
  if (!value) throw new Error(`${label} 为空`);
  let key: Buffer;
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    key = Buffer.from(value, 'base64');
  } else if (/^[0-9a-fA-F]{64}$/i.test(value)) {
    key = Buffer.from(value, 'hex');
  } else {
    key = scryptSync(value, DERIVE_SALT, KEY_LEN);
  }
  if (key.length !== KEY_LEN) {
    throw new Error(`${label} 派生结果须为 ${KEY_LEN} 字节，实际 ${key.length}`);
  }
  return key;
}

/** 密钥指纹：sha256(派生钥) 前 8 位 hex —— 可安全打印/跨机比对，不泄露密钥 */
export function keyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

function readKeyFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`读不到主密钥文件 ${filePath}：${(e as Error).message}。${FIX_HINT}`);
  }
}

/**
 * 解析主密钥，取值顺序：
 * ① `CONFIG_MASTER_KEY`（env 值，过渡/本地可用）；
 * ② `CONFIG_MASTER_KEY_FILE`（默认 {@link DEFAULT_MASTER_KEY_FILE}）指向的 0600 文件。
 *
 * 两者同时存在时**必须指向同一把钥**（派生结果不等即报错），
 * 避免"以为在用 A，实际用 B"这类静默错配。
 */
function resolveMasterKey(): { key: Buffer; source: MasterKeySource; filePath?: string } {
  const envRaw = process.env.CONFIG_MASTER_KEY?.trim();
  const explicitFile = process.env.CONFIG_MASTER_KEY_FILE?.trim();
  const filePath = explicitFile || DEFAULT_MASTER_KEY_FILE;
  const fileExists = existsSync(filePath);

  if (!envRaw && !fileExists) {
    throw new Error(
      explicitFile
        ? `未找到主密钥文件 ${filePath}（CONFIG_MASTER_KEY_FILE 已显式指定）。${FIX_HINT}`
        : `缺少 CONFIG_MASTER_KEY，且默认密钥文件 ${DEFAULT_MASTER_KEY_FILE} 不存在。${FIX_HINT}`,
    );
  }

  if (envRaw && fileExists) {
    const fromEnv = deriveKey(envRaw, 'CONFIG_MASTER_KEY');
    const fromFile = deriveKey(readKeyFile(filePath), 'CONFIG_MASTER_KEY_FILE');
    if (!fromEnv.equals(fromFile)) {
      throw new Error(
        `CONFIG_MASTER_KEY 与文件 ${filePath} 不是同一把钥（指纹 ${keyFingerprint(fromEnv)} vs ${keyFingerprint(fromFile)}），` +
          '请删掉其中之一，避免"以为在用一个钥，实际用另一个"。',
      );
    }
    return { key: fromEnv, source: 'env+file', filePath };
  }

  if (envRaw) return { key: deriveKey(envRaw, 'CONFIG_MASTER_KEY'), source: 'env' };
  return { key: deriveKey(readKeyFile(filePath), 'CONFIG_MASTER_KEY_FILE'), source: 'file', filePath };
}

/**
 * 主密钥：来自环境变量 `CONFIG_MASTER_KEY` 或密钥文件（`CONFIG_MASTER_KEY_FILE`，默认
 * {@link DEFAULT_MASTER_KEY_FILE}），**服务侧持有，不进代码库、不进数据库**。
 * 支持三种形态：base64 / 64 位 hex / 任意字符串（用 scrypt 派生为 32 字节）。
 */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const resolved = resolveMasterKey();
  cachedKey = resolved.key;
  cachedSource = { source: resolved.source, filePath: resolved.filePath };
  return cachedKey;
}

/** 主密钥来源（供启动日志/自检说明，不含密钥值） */
export function masterKeySource(): { source: MasterKeySource; filePath?: string } {
  masterKey();
  return cachedSource as { source: MasterKeySource; filePath?: string };
}

/** 主密钥指纹（供启动日志与 `verify-config-master-key.mjs` 跨机比对） */
export function masterKeyFingerprint(): string {
  return keyFingerprint(masterKey());
}

/** 仅测试用：清除主密钥缓存 */
export function resetMasterKeyCache(): void {
  cachedKey = null;
  cachedSource = null;
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

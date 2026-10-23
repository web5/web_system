import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

/**
 * 账号凭据加解密（AES-256-GCM）
 *
 * 🔴 解密钥只从 **文件** 读（ACCOUNT_CRED_KEY_FILE，权限应为 0600），
 *    **不读进程环境变量** —— 这是 2026-10-23 的定位：环境变量里的明文会被
 *    `pm2 env <id>` / `docker inspect` / 崩溃快照整段打出来，文件 + 权限位才能收窄可见面。
 *
 * 密文格式：base64( iv(12) | tag(16) | ciphertext )，自带 iv 与 tag，无需额外列。
 */
@Injectable()
export class AccountCredentialService implements OnModuleInit {
  private readonly logger = new Logger(AccountCredentialService.name);
  private key: Buffer | null = null;

  /**
   * 启动自检：**只告警不阻断**。
   * 阻断会让"没配 key"直接变成服务起不来（content-hub 还承担采集与发布），
   * 代价过大；真正要加解密时由 encrypt/decrypt 抛明确错误，定位信息一样完整。
   */
  onModuleInit() {
    try {
      this.getKey();
    } catch (e) {
      this.logger.error(`账号凭据解密钥未就绪：${(e as Error).message}`);
    }
  }

  /** 读解密钥（0600 文件）；未配置或不可读 → 抛错，不做静默降级 */
  private getKey(): Buffer {
    if (this.key) return this.key;

    const file = process.env.ACCOUNT_CRED_KEY_FILE;
    if (!file) {
      throw new Error(
        '未配置 ACCOUNT_CRED_KEY_FILE：账号凭据解密钥必须由 0600 文件提供（不进环境变量）',
      );
    }
    if (!existsSync(file)) {
      throw new Error(`ACCOUNT_CRED_KEY_FILE 指向的文件不存在：${file}`);
    }
    const raw = readFileSync(file, 'utf8').trim();
    // 接受 32 字节 hex（64 字符）或 base64（44 字符）
    const buf = /^[0-9a-fA-F]{64}$/.test(raw)
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
      throw new Error(
        `解密钥长度非法（期望 32 字节，实际 ${buf.length}）：${file}`,
      );
    }
    this.key = buf;
    this.logger.log('账号凭据解密钥已加载（来源文件，非环境变量）');
    return buf;
  }

  /** 加密任意 JSON 可序列化对象 */
  encrypt(plain: Record<string, unknown>): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);
    const ct = Buffer.concat([
      cipher.update(JSON.stringify(plain), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
  }

  /** 解密；密文损坏或 key 不匹配会抛错，由调用方决定如何降级 */
  decrypt<T = Record<string, unknown>>(encoded: string): T {
    const buf = Buffer.from(encoded, 'base64');
    if (buf.length < 28) throw new Error('凭据密文长度非法');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.getKey(), iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as T;
  }

  /** 掩码：保留前 2 后 4，中间统一 8 个星号（不泄露长度信息） */
  mask(secret: string): string {
    if (!secret) return '';
    if (secret.length <= 6) return `${secret.slice(0, 1)}********`;
    return `${secret.slice(0, 2)}********${secret.slice(-4)}`;
  }
}

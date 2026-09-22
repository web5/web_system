import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  decryptSecret,
  encryptSecret,
  masterKeyFingerprint,
  masterKeySource,
  resetMasterKeyCache,
} from './config-crypto';

/** 64 位 hex 主密钥（仅测试用） */
const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_KEY = 'aaaabbbbccccddddeeeeffff0000111122223333444455556666777788889999';

describe('config-crypto（主密钥来源与加解密）', () => {
  let dir: string;
  let keyFile: string;

  beforeEach(() => {
    resetMasterKeyCache();
    delete process.env.CONFIG_MASTER_KEY;
    delete process.env.CONFIG_MASTER_KEY_FILE;
    dir = mkdtempSync(join(tmpdir(), 'master-key-'));
    keyFile = join(dir, 'config-master.key');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetMasterKeyCache();
  });

  it('从 env 值读取：加解密往返一致，来源标记为 env', () => {
    process.env.CONFIG_MASTER_KEY = TEST_KEY;
    const cipher = encryptSecret('hy3-api-key');
    expect(decryptSecret(cipher)).toBe('hy3-api-key');
    expect(masterKeySource().source).toBe('env');
    expect(masterKeyFingerprint()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('从文件读取（CONFIG_MASTER_KEY_FILE）：可解密、来源标记为 file', () => {
    writeFileSync(keyFile, `${TEST_KEY}\n`);
    process.env.CONFIG_MASTER_KEY_FILE = keyFile;
    expect(decryptSecret(encryptSecret('secret-from-file'))).toBe('secret-from-file');
    expect(masterKeySource()).toEqual({ source: 'file', filePath: keyFile });
  });

  it('env 与文件同时存在且一致：来源 env+file，指纹与单源一致', () => {
    writeFileSync(keyFile, TEST_KEY);
    process.env.CONFIG_MASTER_KEY = TEST_KEY;
    process.env.CONFIG_MASTER_KEY_FILE = keyFile;
    expect(masterKeySource().source).toBe('env+file');
    const fpBoth = masterKeyFingerprint();

    resetMasterKeyCache();
    delete process.env.CONFIG_MASTER_KEY;
    expect(masterKeyFingerprint()).toBe(fpBoth);
  });

  it('env 与文件不一致：立即报错（不静默选一个）', () => {
    writeFileSync(keyFile, OTHER_KEY);
    process.env.CONFIG_MASTER_KEY = TEST_KEY;
    process.env.CONFIG_MASTER_KEY_FILE = keyFile;
    expect(() => masterKeyFingerprint()).toThrow(/不是同一把钥/);
  });

  it('显式指定的文件不存在：报错带路径与修复指引', () => {
    process.env.CONFIG_MASTER_KEY_FILE = join(dir, 'not-exist.key');
    expect(() => masterKeyFingerprint()).toThrow(/未找到主密钥文件/);
  });

  it('两者都没有：报错同时提到 CONFIG_MASTER_KEY 与默认路径', () => {
    expect(() => masterKeyFingerprint()).toThrow(/CONFIG_MASTER_KEY/);
    expect(() => masterKeyFingerprint()).toThrow(/config-master\.key/);
  });

  it('同一个 keyId 之外的形态：任意字符串走 scrypt 派生仍可往返', () => {
    process.env.CONFIG_MASTER_KEY = 'a-plain-passphrase';
    expect(decryptSecret(encryptSecret('v'))).toBe('v');
  });

  it('密文格式非法时抛错（不由主密钥问题掩盖）', () => {
    process.env.CONFIG_MASTER_KEY = TEST_KEY;
    expect(() => decryptSecret('not-a-valid-payload')).toThrow(/格式非法/);
  });
});

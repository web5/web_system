import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  applyToProcessEnv,
  BOOTSTRAP_FILE,
  bootstrapFixHint,
  loadBootstrapFile,
  mergeConfigRows,
  parseConsoleDsn,
  PROTECTED_ENV_KEYS,
  resolveBootstrapMode,
  runBootstrap,
  type ConfigRow,
} from './load';
import {
  decryptSecret,
  encryptSecret,
  resetMasterKeyCache,
} from '../config/config-crypto';

const MASTER = 'bootstrap-spec-master-key';

function withMaster<T>(fn: () => T): T {
  const prev = process.env.CONFIG_MASTER_KEY;
  process.env.CONFIG_MASTER_KEY = MASTER;
  resetMasterKeyCache();
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.CONFIG_MASTER_KEY;
    else process.env.CONFIG_MASTER_KEY = prev;
    resetMasterKeyCache();
  }
}

function row(p: Partial<ConfigRow> & { key: string; value: string }): ConfigRow {
  return { scope: 'global', envId: '', moduleKey: '', isSecret: false, layer: 'app', ...p };
}

describe('parseConsoleDsn（DSN 解析：错一个字符就连错库，必须当场炸）', () => {
  it('标准形式 → 拆出 host/port/user/pass/db', () => {
    const d = parseConsoleDsn('mysql://root:pw@127.0.0.1:3307/web_system_deploy');
    expect(d).toEqual({
      driver: 'mysql',
      host: '127.0.0.1',
      port: 3307,
      user: 'root',
      password: 'pw',
      database: 'web_system_deploy',
    });
  });

  it('省略端口 → 3306', () => {
    expect(parseConsoleDsn('mysql://u:p@db.host/adb').port).toBe(3306);
  });

  it('密码含特殊字符（URL 编码）→ 正确还原', () => {
    const d = parseConsoleDsn('mysql://u:p%40ss%3Aword@db.host/adb');
    expect(d.password).toBe('p@ss:word');
  });

  it('空值 / 非 mysql / 缺库名 → 抛错（不接受猜测）', () => {
    expect(() => parseConsoleDsn('')).toThrow(/为空/);
    expect(() => parseConsoleDsn('postgres://u:p@h/db')).toThrow(/只支持 mysql/);
    expect(() => parseConsoleDsn('mysql://u:p@h')).toThrow(/缺少库名/);
  });
});

describe('resolveBootstrapMode（渐进切换：不声明就不强制）', () => {
  it('有 CONSOLE_ENV_ID → bootstrap 模式', () => {
    expect(resolveBootstrapMode({ CONSOLE_ENV_ID: 'dev' } as NodeJS.ProcessEnv)).toBe('bootstrap');
  });

  it('无 CONSOLE_ENV_ID → legacy 模式（现网 .env 全量场景零影响）', () => {
    expect(resolveBootstrapMode({} as NodeJS.ProcessEnv)).toBe('legacy');
    expect(resolveBootstrapMode({ CONSOLE_ENV_ID: '  ' } as NodeJS.ProcessEnv)).toBe('legacy');
  });
});

describe('loadBootstrapFile（pm2 场景下没人替我们读文件）', () => {
  const prevCwd = process.cwd();

  function inTempDir(fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'bootstrap-spec-'));
    try {
      process.chdir(dir);
      fn(dir);
    } finally {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('读文件；进程环境优先不被覆盖；空值行跳过', () => {
    inTempDir((dir) => {
      writeFileSync(
        join(dir, BOOTSTRAP_FILE),
        '# 注释行\nCONSOLE_ENV_ID=dev\nCONSOLE_DB_DSN=mysql://u:p@h/db\nEMPTY=\n',
      );
      const env = { CONSOLE_ENV_ID: 'prod' } as NodeJS.ProcessEnv;
      expect(loadBootstrapFile(env)).toEqual(['CONSOLE_DB_DSN']);
      expect(env.CONSOLE_ENV_ID).toBe('prod');
      expect(env.CONSOLE_DB_DSN).toBe('mysql://u:p@h/db');
    });
  });

  it('文件不存在 → 空数组、不抛错（现状模式本来就没有这个文件）', () => {
    inTempDir(() => {
      expect(loadBootstrapFile({} as NodeJS.ProcessEnv)).toEqual([]);
    });
  });
});

describe('mergeConfigRows（作用域裁决 + 硬保护）', () => {
  it('优先级 module > env > global', () => {
    const r = mergeConfigRows([
      row({ key: 'PORT', value: '6200' }),
      row({ key: 'PORT', value: '6300', scope: 'env', envId: 'dev' }),
      row({ key: 'PORT', value: '6400', scope: 'module', envId: 'dev', moduleKey: 'deploy-console' }),
    ]);
    expect(r.values.get('PORT')).toBe('6400');

    const r2 = mergeConfigRows([
      row({ key: 'P', value: 'g' }),
      row({ key: 'P', value: 'e', scope: 'env', envId: 'dev' }),
    ]);
    expect(r2.values.get('P')).toBe('e');
  });

  it("layer=bootstrap 的键一律跳过（读配置中心之前它就得在，读回来覆盖自己不成立）", () => {
    const r = mergeConfigRows([row({ key: 'MYSQL_HOST', value: 'x', layer: 'bootstrap' })]);
    expect(r.values.has('MYSQL_HOST')).toBe(false);
    expect(r.skippedByLayer).toEqual(['MYSQL_HOST']);
  });

  it('基础设施键即使落在 app 层也被硬保护拦下（防误配连错库）', () => {
    const r = mergeConfigRows([row({ key: 'DB_HOST', value: 'evil.host', layer: 'app' })]);
    expect(r.values.has('DB_HOST')).toBe(false);
    expect(r.skipped).toContain('DB_HOST');
    expect(PROTECTED_ENV_KEYS.has('DB_HOST')).toBe(true);
    expect(PROTECTED_ENV_KEYS.has('DB_SYNCHRONIZE')).toBe(true);
  });

  it('未知作用域忽略（宁可不生效，也不猜语义）', () => {
    const r = mergeConfigRows([row({ key: 'X', value: '1', scope: 'who-knows' })]);
    expect(r.values.size).toBe(0);
  });

  it('密钥项解密后入库；解不开则点名跳过，不拖垮整体', () => {
    withMaster(() => {
      const secret = encryptSecret('plain-value');
      const ok = mergeConfigRows([row({ key: 'S', value: secret, isSecret: true })]);
      expect(ok.values.get('S')).toBe('plain-value');
      expect(decryptSecret(secret)).toBe('plain-value');
    });

    // 换一把主密钥 → 解密必然失败（GCM 认证失败）
    const bad = withMaster(() => encryptSecret('x'));
    const prev = process.env.CONFIG_MASTER_KEY;
    process.env.CONFIG_MASTER_KEY = 'another-master-key';
    resetMasterKeyCache();
    const r = mergeConfigRows([row({ key: 'S', value: bad, isSecret: true })]);
    if (prev === undefined) delete process.env.CONFIG_MASTER_KEY;
    else process.env.CONFIG_MASTER_KEY = prev;
    resetMasterKeyCache();
    expect(r.values.has('S')).toBe(false);
    expect(r.decryptErrors[0]).toContain('S');
  });
});

describe('applyToProcessEnv（合并进进程环境）', () => {
  it('写入生效，同值重复写入不计数', () => {
    const env = { A: '1' } as NodeJS.ProcessEnv;
    const r1 = mergeConfigRows([row({ key: 'A', value: '1' }), row({ key: 'B', value: '2' })]);
    expect(applyToProcessEnv(r1, env)).toBe(1); // 只有 B 变了
    expect(env.B).toBe('2');
    expect(applyToProcessEnv(r1, env)).toBe(0); // 幂等
  });
});

describe('bootstrapFixHint（缺键要给可照抄的指引）', () => {
  it('含缺失键名与三键样例', () => {
    const hint = bootstrapFixHint(['CONSOLE_DB_DSN']);
    expect(hint).toContain('CONSOLE_DB_DSN');
    expect(hint).toContain('CONSOLE_ENV_ID=');
    expect(hint).toContain('CONSOLE_DB_DSN=mysql://');
    expect(hint).toContain('CONFIG_MASTER_KEY_FILE=');
  });
});

describe('runBootstrap（失败分档：缺键致命，库抖动不致命）', () => {
  const baseEnv = () =>
    ({ CONSOLE_ENV_ID: 'dev' } as NodeJS.ProcessEnv);

  beforeEach(() => {
    jest.resetModules();
  });

  it('legacy 模式：不连库，返回 loaded=false', async () => {
    const out = await runBootstrap({} as NodeJS.ProcessEnv);
    expect(out.mode).toBe('legacy');
    expect(out.loaded).toBe(false);
    expect(out.warning).toMatch(/legacy/);
  });

  it('bootstrap 模式缺 DSN / 主密钥 → 抛错（半自举比不自举更危险）', async () => {
    await expect(runBootstrap(baseEnv())).rejects.toThrow(/CONSOLE_DB_DSN/);

    // 主密钥是否可用由 config-crypto 判定（读 process.env + 默认文件），故断言
    // 「缺失」前必须清干净进程残留 —— 否则在装了默认文件的机器上这条会假绿
    resetMasterKeyCache();
    delete process.env.CONFIG_MASTER_KEY;
    delete process.env.CONFIG_MASTER_KEY_FILE;
    const withDsn = { ...baseEnv(), CONSOLE_DB_DSN: 'mysql://u:p@127.0.0.1:3306/db' };
    await expect(runBootstrap(withDsn as NodeJS.ProcessEnv)).rejects.toThrow(/CONFIG_MASTER_KEY/);
  });

  it('主密钥可用时不再报缺失（启动校验必须与运行期同源）', async () => {
    // dev 演练实测：.env 里 CONFIG_MASTER_KEY 是空值、也没写 *_FILE，密钥其实在
    // config-crypto 的默认文件里 —— 只看 env 变量会误判成缺键并 FATAL。
    resetMasterKeyCache();
    const env = {
      CONSOLE_ENV_ID: 'dev',
      CONSOLE_DB_DSN: 'mysql://u:p@127.0.0.1:1/db',
      CONFIG_MASTER_KEY: 'spec-master-key-present',
    } as NodeJS.ProcessEnv;
    const out = await runBootstrap(env);
    expect(out.warning).not.toMatch(/CONFIG_MASTER_KEY/);
    resetMasterKeyCache();
    // 显式超时：这条会真的去连一次 mysql（端口 1 ≈ 立即 ECONNREFUSED，但 I/O 等待
    // 在 CI 满载时可能超 jest 默认 5s）。失败的是环境不是断言，别让它变成红灯误导。
  }, 20000);

  it('库连不上 → 只告警不抛（DB 抖动不该让发布系统起不来）', async () => {
    const env = {
      ...baseEnv(),
      CONSOLE_DB_DSN: 'mysql://u:p@127.0.0.1:1/db',
      CONFIG_MASTER_KEY: MASTER,
    } as NodeJS.ProcessEnv;
    const out = await runBootstrap(env);
    expect(out.mode).toBe('bootstrap');
    expect(out.loaded).toBe(false);
    expect(out.warning).toBeTruthy();
  }, 20000);
});

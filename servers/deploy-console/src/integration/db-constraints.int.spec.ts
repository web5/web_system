/**
 * DB 集成测试：deploy-console 数据库约束与迁移验证
 *
 * 由 scripts/_test-p0.mjs + _test-p1.mjs 迁移而来（2026-10-23）。
 * 需要真实 MySQL（web_system_deploy 库），CI 中被 testPathIgnorePatterns 排除。
 *
 * 本地运行（推荐）:
 *   set -a; source ~/env_config/web_system/local-mysql.env; set +a
 *   cd servers/deploy-console
 *   npx jest --config jest.int.config.js
 *
 * 或显式指定:
 *   DB_PASSWORD=xxx npx jest --config jest.int.config.js
 *
 * 连接驱动：mysql2（deploy-console 已有依赖，不依赖 mysql CLI）。
 *
 * 跳过语义（2026-10-23 修正假绿）:
 *   - 未提供任何凭证 → 全部 test.skip（列表里显示 skipped，不显示 passed）
 *   - 提供了凭证但连不上 → beforeAll 抛错，套件判红（不允许静默通过）
 *
 * 检查项:
 *   P0: deploy_deployments 无重复组 / uk_env_module 唯一约束 / 无 mf: 前缀
 *   P1: deploy_servers + deploy_env_service_routes 表存在 / 迁移数据 / 唯一约束
 */
import mysql from 'mysql2/promise';
import type { Connection, RowDataPacket } from 'mysql2/promise';

const DB_HOST = process.env.DB_HOST || process.env.MYSQL_LOCAL_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || process.env.MYSQL_LOCAL_PORT || 3306);
const DB_USER = process.env.DB_USERNAME || process.env.MYSQL_LOCAL_USER || 'root';
const DB_PASS = process.env.DB_PASSWORD || process.env.MYSQL_LOCAL_PASSWORD || '';
const DB = process.env.DB_DATABASE || 'web_system_deploy';

/** 有任一凭证来源即认为"用户要求真跑" */
const HAS_CREDS = Boolean(DB_PASS);

let conn: Connection | null = null;

const q = async (sql: string): Promise<string> => {
  if (!conn) throw new Error('DB 未连接');
  const [rows] = await conn.query<RowDataPacket[]>(sql);
  const first = rows[0] as Record<string, unknown>;
  const val = first ? first[Object.keys(first)[0]] : '';
  return String(val ?? '');
};

const exec = async (sql: string): Promise<void> => {
  if (!conn) throw new Error('DB 未连接');
  await conn.query(sql);
};

beforeAll(async () => {
  if (!HAS_CREDS) {
    console.warn('⚠ 未提供 DB 凭证（DB_PASSWORD / MYSQL_LOCAL_PASSWORD），集成测试将标记为 skipped');
    return;
  }
  try {
    conn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB,
    });
    await conn.query('SELECT 1');
  } catch (e: any) {
    // 凭证给了却连不上 = 环境问题，必须判红，不许假绿
    throw new Error(
      `MySQL 连接失败（${DB_USER}@${DB_HOST}:${DB_PORT}/${DB}）: ${e?.message || e}。` +
        ` 提供了凭证就必须连上；如暂不想跑集成测试，请勿设置 DB_PASSWORD/MYSQL_LOCAL_PASSWORD。`,
    );
  }
});

afterAll(async () => {
  if (conn) await conn.end();
});

/** 无凭证时统一 skip（jest 列表里显示 skipped 而非 passed） */
const maybeIt = HAS_CREDS ? it : it.skip;

describe('P0 · deploy_deployments 约束', () => {
  maybeIt('无重复组（env_id + module_key）', async () => {
    const dup = await q(
      'SELECT COUNT(*) AS n FROM (SELECT env_id, module_key FROM deploy_deployments GROUP BY env_id, module_key HAVING COUNT(*)>1) t',
    );
    expect(dup).toBe('0');
  });

  maybeIt('uk_env_module 唯一约束生效（重复插入被拒）', async () => {
    await exec(`DELETE FROM deploy_deployments WHERE id='test-dup-x'`);
    let rejected = false;
    try {
      await exec(
        `INSERT INTO deploy_deployments (id, env_id, module_key, current_version, status) VALUES ('test-dup-x','dev','portal','x','deployed')`,
      );
    } catch (e: any) {
      const msg = (e?.message || '') + (e?.sqlMessage || '');
      rejected = /Duplicate entry/.test(msg);
    }
    await exec(`DELETE FROM deploy_deployments WHERE id='test-dup-x'`);
    expect(rejected).toBe(true);
  });

  maybeIt('deploy_versions 无 mf: 前缀残留', async () => {
    const mf = await q(`SELECT COUNT(*) AS n FROM deploy_versions WHERE component LIKE 'mf:%'`);
    expect(mf).toBe('0');
  });
});

describe('P1 · deploy_servers / deploy_env_service_routes', () => {
  maybeIt('两张表存在', async () => {
    const tables = await q(
      `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DB}' AND TABLE_NAME IN ('deploy_servers','deploy_env_service_routes')`,
    );
    expect(tables).toBe('2');
  });

  maybeIt('默认服务器数 = 3', async () => {
    const cnt = await q('SELECT COUNT(*) AS n FROM deploy_servers');
    expect(cnt).toBe('3');
  });

  maybeIt('默认路由数 ≥ 20（迁移数据到位）', async () => {
    // 实测 2026-10-23 为 28（env×service 随业务增减，不锁死 30）
    const cnt = await q('SELECT COUNT(*) AS n FROM deploy_env_service_routes');
    expect(Number(cnt)).toBeGreaterThanOrEqual(20);
  });

  maybeIt('uk_server_name_host 复合唯一约束生效（同组+同主机二次插入被拒）', async () => {
    // 实体定义 @Unique(['serverName','host'])：同「服务器组名+主机」唯一，不同组可同主机
    await exec(`DELETE FROM deploy_servers WHERE id IN ('t1','t1b')`);
    await exec(
      `INSERT INTO deploy_servers (id, server_name, host, ssh_user, remote_dir) VALUES ('t1','dup-grp','dup-host.example.com','ubuntu','/data')`,
    );
    let rejected = false;
    try {
      await exec(
        `INSERT INTO deploy_servers (id, server_name, host, ssh_user, remote_dir) VALUES ('t1b','dup-grp','dup-host.example.com','ubuntu','/data')`,
      );
    } catch (e: any) {
      const msg = (e?.message || '') + (e?.sqlMessage || '');
      rejected = /Duplicate entry/.test(msg);
    }
    await exec(`DELETE FROM deploy_servers WHERE id IN ('t1','t1b')`);
    expect(rejected).toBe(true);
  });

  maybeIt('uk_env_service 唯一约束生效（同 env+service 二次插入被拒）', async () => {
    await exec(`DELETE FROM deploy_env_service_routes WHERE id IN ('t2','t2b')`);
    await exec(
      `INSERT INTO deploy_env_service_routes (id, env_id, service_name, server_name) VALUES ('t2','dup-env','dup-svc','x')`,
    );
    let rejected = false;
    try {
      await exec(
        `INSERT INTO deploy_env_service_routes (id, env_id, service_name, server_name) VALUES ('t2b','dup-env','dup-svc','x')`,
      );
    } catch (e: any) {
      const msg = (e?.message || '') + (e?.sqlMessage || '');
      rejected = /Duplicate entry/.test(msg);
    }
    await exec(`DELETE FROM deploy_env_service_routes WHERE id IN ('t2','t2b')`);
    expect(rejected).toBe(true);
  });
});

#!/usr/bin/env node
/**
 * P1 集成测试：真实 DB 验证
 * 1) deploy_servers / deploy_env_service_routes 表存在
 * 2) 迁移数据：3 个默认 serverName + 30 条默认路由
 * 3) 唯一约束生效（重复 server / 重复路由被拒）
 */
import { execSync } from 'child_process';

const MYSQL = '/Users/geekwen/local/mysql-8.4.0-macos14-arm64/bin/mysql';
const AUTH = `-h127.0.0.1 -uroot -p'KedouLocal@2026'`;
const DB = 'web_system_deploy';

const q = (sql) =>
  execSync(`${MYSQL} ${AUTH} ${DB} -N -e "${sql}" 2>/dev/null`).toString().trim();

let passed = 0;
let failed = 0;
const assert = (name, cond) => {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
};

console.log('P1 集成测试开始...\n');

// 1. 表存在
const tables = q("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='web_system_deploy' AND TABLE_NAME IN ('deploy_servers','deploy_env_service_routes')");
assert('两张表 deploy_servers / deploy_env_service_routes 存在', tables === '2');

// 2. 迁移数据
const serverCnt = q('SELECT COUNT(*) FROM deploy_servers');
const routeCnt = q('SELECT COUNT(*) FROM deploy_env_service_routes');
assert(`默认服务器数 = 3（实际=${serverCnt}）`, serverCnt === '3');
assert(`默认路由数 = 30（实际=${routeCnt}）`, routeCnt === '30');

// 3. 唯一约束：重复 server（同 server_name+host）被拒
try {
  execSync(
    `${MYSQL} ${AUTH} ${DB} -e "INSERT INTO deploy_servers (id, server_name, host, ssh_user, remote_dir) VALUES ('t1','dev-default','175.27.189.123','ubuntu','/data')" 2>&1`,
  );
  assert('唯一约束 uk_server_host 生效（重复 server 被拒）', false);
} catch (e) {
  const msg = (e.stdout || '').toString() + (e.message || '');
  assert('唯一约束 uk_server_host 生效（重复 server 被拒）', /Duplicate entry/.test(msg));
}

// 4. 唯一约束：重复路由（同 env_id+service_name）被拒
try {
  execSync(
    `${MYSQL} ${AUTH} ${DB} -e "INSERT INTO deploy_env_service_routes (id, env_id, service_name, server_name) VALUES ('t2','dev','gateway','x')" 2>&1`,
  );
  assert('唯一约束 uk_env_service 生效（重复路由被拒）', false);
} catch (e) {
  const msg = (e.stdout || '').toString() + (e.message || '');
  assert('唯一约束 uk_env_service 生效（重复路由被拒）', /Duplicate entry/.test(msg));
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

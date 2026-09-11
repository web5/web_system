#!/usr/bin/env node
/**
 * P0 集成测试：真实 DB 验证
 * 1) deploy_deployments 去重后无重复组
 * 2) 唯一约束 uk_env_module 生效（重复插入被拒）
 * 3) deploy_versions 无 mf: 前缀残留
 */
import { execSync } from 'child_process';

const MYSQL = process.env.MYSQL_BIN || 'mysql';
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_USER = process.env.DB_USERNAME || 'root';
const DB_PASS = process.env.DB_PASSWORD || '';
const AUTH = `-h${DB_HOST} -u${DB_USER}${DB_PASS ? ` -p'${DB_PASS}'` : ''}`;
const DB = process.env.DB_DATABASE || 'web_system_deploy';

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

console.log('P0 集成测试开始...\n');

// 1. 无重复组
const dup = q(
  'SELECT COUNT(*) FROM (SELECT env_id, module_key FROM deploy_deployments GROUP BY env_id, module_key HAVING COUNT(*)>1) t',
);
assert(`deploy_deployments 无重复组（实际重复组数=${dup}）`, dup === '0');

// 2. 唯一约束生效（先清残留，保证断言准确）
q(`DELETE FROM deploy_deployments WHERE id='test-dup-x'`);
try {
  execSync(
    `${MYSQL} ${AUTH} ${DB} -e "INSERT INTO deploy_deployments (id, env_id, module_key, current_version, status) VALUES ('test-dup-x','dev','portal','x','deployed')" 2>&1`,
  );
  assert('唯一约束 uk_env_module 生效（重复插入被拒）', false);
} catch (e) {
  const msg = (e.stdout || '').toString() + (e.message || '');
  assert('唯一约束 uk_env_module 生效（重复插入被拒）', /Duplicate entry/.test(msg));
}
q(`DELETE FROM deploy_deployments WHERE id='test-dup-x'`);

// 3. 无 mf: 前缀
const mf = q(`SELECT COUNT(*) FROM deploy_versions WHERE component LIKE 'mf:%'`);
assert(`deploy_versions 无 mf: 前缀（实际残留=${mf}）`, mf === '0');

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

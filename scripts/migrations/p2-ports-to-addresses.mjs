/**
 * P2 迁移：deploy_environments.ports 从 {key: number(端口)} 转为 {key: string(完整地址)}。
 */
import { execSync } from 'child_process';

const MYSQL = '/Users/geekwen/local/mysql-8.4.0-macos14-arm64/bin/mysql';
const AUTH = "-h127.0.0.1 -uroot -p'KedouLocal@2026'";
const DB = 'web_system_deploy';

function run(sql, flags = '') {
  return execSync(`${MYSQL} ${AUTH} ${DB} ${flags} -e "${sql}" 2>/dev/null`, { encoding: 'utf8' });
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const hostByEnv = {
  dev: '127.0.0.1',
  prod: 'portal.kedouai.com',
  staging: 'stage.kedouai.com',
};

// 1. 逐环境读 id + ports（-N 去表头，-B 用 tab 分隔）
const raw = run('SELECT id, ports FROM deploy_environments', '-N -B');
const lines = raw.trim().split('\n').filter(Boolean);

const updates = [];
for (const line of lines) {
  const idx = line.indexOf('\t');
  if (idx < 0) continue;
  const id = line.slice(0, idx).trim();
  const portsStr = line.slice(idx + 1).trim();
  if (!portsStr || portsStr === 'NULL') continue;
  let ports;
  try {
    ports = JSON.parse(portsStr);
  } catch {
    console.warn(`[skip] ${id} ports 解析失败: ${portsStr.slice(0, 60)}`);
    continue;
  }
  const host = hostByEnv[id] || '127.0.0.1';
  const newPorts = {};
  let changed = false;
  for (const [k, v] of Object.entries(ports)) {
    if (typeof v === 'string') {
      newPorts[k] = v;
    } else if (typeof v === 'number') {
      newPorts[k] = `${host}:${v}`;
      changed = true;
    } else {
      newPorts[k] = v;
    }
  }
  if (changed) {
    // JSON 里的双引号在 shell 双引号上下文中需转义为 \"
    const json = JSON.stringify(newPorts).replace(/"/g, '\\"');
    updates.push(`UPDATE deploy_environments SET ports = '${json}' WHERE id = '${esc(id)}';`);
  }
}

if (updates.length === 0) {
  console.log('无需迁移（所有 ports 已是地址字符串或为空）');
  process.exit(0);
}

console.log(`将迁移 ${updates.length} 个环境：\n${updates.join('\n')}\n`);
for (const sql of updates) {
  run(sql);
}

// 2. 验证
const verifyRaw = run('SELECT id, ports FROM deploy_environments', '-N -B');
console.log('\n迁移后：');
for (const line of verifyRaw.trim().split('\n').filter(Boolean)) {
  const idx = line.indexOf('\t');
  const id = line.slice(0, idx).trim();
  const portsStr = line.slice(idx + 1).trim();
  console.log(`  ${id}: ${portsStr}`);
}

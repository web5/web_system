#!/usr/bin/env node
/**
 * 发布前密钥泄漏扫描：
 * 检查 dist/ 与 bin/ 中是否包含疑似 API Key（如 sk-、Bearer、AKID 等字样）。
 * 发现则中止发布（exit 1），防止真实密钥被打进 npm 包。
 */
const fs = require('fs');
const path = require('path');

const ROOTS = ['dist', 'bin'];
// 疑似密钥特征（真实密钥值特征，避免误报环境变量名）
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{12,}/,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/,
  /\bAKID[A-Za-z0-9]{16,}/,
  /["'](?:sk|AKIA|SG|ghp|gho|glpat|xox)[A-Za-z0-9_-]{16,}["']/,
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const re of SECRET_PATTERNS) {
      if (re.test(text)) {
        violations.push(`${file} 命中疑似密钥模式: ${re}`);
        break;
      }
    }
  }
}

if (violations.length > 0) {
  console.error('❌ 发布中止：检测到疑似密钥泄漏！');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('✅ 密钥扫描通过：dist/bin 中未发现疑似 API Key');

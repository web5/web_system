/**
 * KEYS 漂移守卫（纯文件 IO，preflight 阶段秒级完成）
 *
 * 背景：产品侧 storage key 真源散在 .ts 私有常量与行内字面量里，裸 node runner
 * 无法直接 import（见 README 第⑥章）。故 KEYS 留在各 app e2e.config.js，
 * 本守卫对产品源码做字面量扫描「自动对账」：任一 key 值在源码中找不到即 FAIL-fast
 * （红在 launch 之前），产品侧 key 改名/删除时 e2e 第一时间红。
 */

const fs = require('fs');
const path = require('path');

/** 只扫这些文本扩展名（跳过图片/.key 等二进制与凭证文件） */
const SCANNABLE_EXT = new Set(['.ts', '.js', '.json', '.wxml', '.wxss', '.wxs']);

const DEFAULT_EXCLUDE = ['node_modules', 'tests'];

/**
 * 默认排除文件：e2e.config.js 本身（key 值字面量就写在里面，
 * 不排除会「自己扫到自己」造成守卫永远绿的假阳性——2026-11-11 V4 实测抓获）
 */
const DEFAULT_EXCLUDE_FILES = ['e2e.config.js'];

/** 递归收集 srcDir 下全部可扫描文件（跳过排除目录与排除文件） */
function collectSourceFiles(srcDir, exclude = DEFAULT_EXCLUDE, excludeFiles = DEFAULT_EXCLUDE_FILES) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!exclude.includes(entry.name)) walk(path.join(dir, entry.name));
      } else if (
        entry.isFile() &&
        SCANNABLE_EXT.has(path.extname(entry.name)) &&
        !excludeFiles.includes(entry.name)
      ) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(srcDir);
  return out;
}

/**
 * 对 keys 每个值在产品源码目录做字面量扫描，找不到即 FAIL-fast。
 * @param {{ keys: Record<string,string>, srcDir: string, exclude?: string[], excludeFiles?: string[] }} opts
 * @throws 任一 key 缺失时抛错，文案含缺失 key 别名/值与扫描目录
 */
function assertKeysInSource({ keys, srcDir, exclude = DEFAULT_EXCLUDE, excludeFiles = DEFAULT_EXCLUDE_FILES }) {
  const files = collectSourceFiles(srcDir, exclude, excludeFiles);
  // 一次性拼 corpus，避免每个 key 重复读文件
  const corpus = files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');
  const missing = Object.entries(keys).filter(([, value]) => !corpus.includes(value));
  if (missing.length > 0) {
    const lines = missing.map(([alias, value]) => `  - ${alias}: '${value}'`).join('\n');
    throw new Error(
      `[keys-guard] e2e.config.js 中有 ${missing.length} 个 storage key 在产品源码中找不到（已扫描 ${srcDir}，排除 ${exclude.join('/')}）：\n` +
        `${lines}\n` +
        `  处置：核对产品侧 key 是否改名/删除；若产品新增 key，请同步 e2e.config.js storageKeys 并补真源注释。`,
    );
  }
  return { scanned: files.length, keys: Object.keys(keys).length };
}

module.exports = { assertKeysInSource, collectSourceFiles, DEFAULT_EXCLUDE, DEFAULT_EXCLUDE_FILES };

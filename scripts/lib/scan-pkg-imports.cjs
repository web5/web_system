/**
 * 源码扫描公共库（CJS）——被两个脚本共用，避免正则/目录清单漂移：
 *   - scripts/build-subset-externals.mjs（生成 antd / icons 按需子集）
 *   - scripts/verify-cdn-subsets.cjs（校验子集运行时是否缺东西）
 *
 * 为什么单独抽出来：子集是「扫源码自动生成」的，一旦扫描口径与校验口径不一致，
 * 就会出现「构建时漏了、校验时也查不到」的双盲区 —— 线上表现为图标空白，
 * 构建和 CI 全绿。2026-10-23 的菜单图标缺失就是这么溜过去的。
 */

const { readdirSync, statSync, readFileSync } = require('fs');
const { join } = require('path');

/**
 * 参与扫描的源码目录（微前端链路：基座 + 两个模块 + 共享 UI）。
 * 放在这里而不是各脚本里，是为了让「构建子集」和「校验子集」永远扫同一批文件。
 */
const SCAN_DIRS = [
  'apps/shell/src',
  'apps/admin/src',
  'apps/portal/src',
  'packages/ui/src',
];

/**
 * 扫描时排除的文件。
 *
 * `apps/shell/src/antd-all.ts` 是为「保留 cssinjs 样式模板」而全量 import + 全量注册
 * antd 的历史 workaround。它不是真实使用面，纳入会让子集退化成接近全量。
 * 排除后该文件里缺失的组件会拿到 undefined —— 其注册循环有
 * `typeof install === 'function'` 运行时判断，缺失项静默跳过，不会崩；
 * 将来真正用到某个组件时，模板 `<a-xxx>` 扫描会把它自动补回子集。
 */
const SCAN_EXCLUDE_FILES = ['antd-all.ts'];

/** 递归收集源码文件（.vue/.ts/.tsx/.js），跳过指定文件名 */
function collectSources(dirs, { exclude = [] } = {}) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (/\.(vue|ts|tsx|js)$/.test(e) && !exclude.includes(e)) {
        files.push({ path: p, code: readFileSync(p, 'utf-8') });
      }
    }
  };
  for (const d of dirs) walk(d);
  return files;
}

/**
 * 收集 `import { A, B as C } from '<pkg>'` 的**原始导出名**（别名取原名）。
 * 不收集 `import * as X`（那是全量，会被子集破坏）。
 *
 * ⚠️ 必须先剥注释再按逗号切分。
 *
 * import 块里允许写注释，而中文注释常自带逗号（例：`// 否则展开后是一片纯文本，
 * 和其他分组的视觉节奏不一致。`）。直接 split(',') 会把「注释尾巴 + 紧邻的下一个
 * 标识符」粘成同一段；调用方那条 `^[A-Za-z][A-Za-z0-9]*$` 校验看到中文就整段丢弃，
 * 于是**紧跟在含逗号注释后面的那个图标被静默漏掉**。
 *
 * 实际踩坑：BasicLayout.vue 的两行注释把 `CloudServerOutlined` 吞了，共享 icons
 * 子集少这一个 → 线上左侧菜单「采集源管理」永远没有图标（#439）。
 */
function collectNamedImports(code, pkg) {
  const names = new Set();
  const esc = pkg.replace(/[/@]/g, '\\$&');
  const re = new RegExp(`(?:import|export)\\s*\\{([^}]*)\\}\\s*from\\s*['"\`]${esc}['"\`]`, 'g');
  let m;
  while ((m = re.exec(code))) {
    const body = m[1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const raw of body.split(',')) {
      const s = raw.trim();
      if (!s) continue;
      const asIdx = s.toLowerCase().indexOf(' as ');
      const name = (asIdx >= 0 ? s.slice(0, asIdx) : s).trim();
      if (/^[A-Za-z][A-Za-z0-9]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** 收集模板里的 `<a-xxx-yyy>` 标签名（kebab） */
function collectTemplateTags(code) {
  const tags = new Set();
  const re = /<a-([a-z0-9-]+)/g;
  let m;
  while ((m = re.exec(code))) tags.add(m[1]);
  return tags;
}

module.exports = {
  SCAN_DIRS,
  SCAN_EXCLUDE_FILES,
  collectSources,
  collectNamedImports,
  collectTemplateTags,
};

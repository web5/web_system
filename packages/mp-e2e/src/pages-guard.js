/**
 * page path 注册守卫（R2）：preflight 静态校验 case 内导航 path 已在 app.json 注册。
 *
 * readRegisteredPages 移植自 apps/kedou-ai-minigram/scripts/preview.js L176–184
 * （含 subPackages root 拼接、root 尾斜杠处理），参数化为 appJsonPath。
 *
 * ⚠️ pages 字段在 app.json，project.config.json 里没有（别读错了会拿到空数组）。
 */

const fs = require('fs');
const path = require('path');
const { normalizePath } = require('./navigate');

/**
 * 读取 app.json 中全部注册页面（含分包）。
 * root 无尾斜杠（如 "packageTranslate"），page 无前导斜杠（如 "pages/xxx"），需自行补 /。
 */
function readRegisteredPages(appJsonPath) {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf-8'));
  const pages = [...(appJson.pages || [])];
  (appJson.subPackages || appJson.subpackages || []).forEach((sp) => {
    (sp.pages || []).forEach((p) => pages.push(`${(sp.root || '').replace(/\/$/, '')}/${p}`));
  });
  return pages;
}

/**
 * 从 case 文件源码静态提取导航目标 path 字面量。
 * 命中 ctx.switchTab/navigateTo/reLaunch/navigateBack(mp, '<path>...') 的第二参数字面量；
 * 动态拼接的 url（如 '...?fwd=' + encodeURIComponent(...)）取字面量前缀，query 由 normalizePath 去掉。
 */
function extractNavPaths(source) {
  const re = /ctx\.(switchTab|navigateTo|reLaunch|navigateBack)\s*\([^,]+,\s*['"`]([^'"`]+)['"`]/g;
  const out = [];
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({ method: m[1], raw: m[2], path: normalizePath(m[2]) });
  }
  return out;
}

/**
 * 静态校验：entryPath 与 casesDir 内全部 case 的导航 path 都已注册。
 * @param {{ entryPath: string, casesDir: string, appJsonPath: string }} opts
 * @throws 存在未注册 path 时抛错（列出 path、来源文件与可用页面数）
 */
function assertPagesRegistered({ entryPath, casesDir, appJsonPath }) {
  const registered = readRegisteredPages(appJsonPath);
  const bad = [];

  if (entryPath && !registered.includes(entryPath)) {
    bad.push({ from: 'e2e.config.js entryPath', path: entryPath });
  }

  const caseFiles = fs.existsSync(casesDir)
    ? fs.readdirSync(casesDir).filter((f) => f.endsWith('.js')).sort()
    : [];
  for (const f of caseFiles) {
    const src = fs.readFileSync(path.join(casesDir, f), 'utf-8');
    for (const hit of extractNavPaths(src)) {
      if (!registered.includes(hit.path)) {
        bad.push({ from: `${f} (${hit.method} '${hit.raw}')`, path: hit.path });
      }
    }
  }

  if (bad.length > 0) {
    const lines = bad.map((b) => `  - ${b.path}    ← ${b.from}`).join('\n');
    throw new Error(
      `[pages-guard] 有 ${bad.length} 处导航目标未在 app.json（含 subPackages）注册：\n` +
        `${lines}\n` +
        `  处置：核对 page path 拼写；若页面已下线，请按用例卡流程重写该用例（README 附录 A）。`,
    );
  }
  return { registered: registered.length, checked: bad.length === 0 ? caseFiles.length : 0 };
}

module.exports = { readRegisteredPages, extractNavPaths, assertPagesRegistered };

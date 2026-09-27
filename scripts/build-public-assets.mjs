#!/usr/bin/env node
/**
 * 公共静态资源 → servers/gateway/public/static/cdn/pub/（自建 CDN 的第二类内容）。
 *
 * 输入：**单一源目录** assets/shared-public/（入 git，是唯一真值）
 *   assets/shared-public/logo.svg
 *   assets/shared-public/avatars/default-male.png, default-female.png
 *   assets/shared-public/materials/svg/*.svg   ← 由 apps/portal/scripts/generate-materials.mjs 生成
 *
 * 输出：servers/gateway/public/static/cdn/pub/**（构建产物，.gitignore）
 *   与 scripts/build-externals.mjs 产出的 vue/antd UMD 同处 `public/static/cdn/` 下，
 *   **天然复用 scripts/deploy.sh 的 deploy_cdn() 投递通道**（整包 tar 覆盖远端 cdn/），无需改流水线。
 *
 * 为什么必须收口成一份：
 *   历史上有三份拷贝互相漂移 —— apps/portal/public、apps/admin/public、servers/gateway/public，
 *   再加每个微前端版本目录各一份（随 base 走）。资源一改，四处不同步，且都无报错。
 *
 * 为什么不再放进各 app 的 public/：
 *   app public/ 会被 Vite 整包拷进 dist → 每个版本目录重复 4~5MB，且要求投递到「正确的那一段」目录。
 *   收口后 app 侧彻底没有 public 资源，产物只剩入口文件， '<产品线>/<版本>' 双目录约束失效。
 *
 * 本地/独立构建怎么加载：
 *   由 gateway 托管（/: /static/cdn/pub/*），各 app 的 vite.config.ts 已加 dev proxy：
 *   `/static` → http://localhost:6000（网关本机端口）。
 *
 * 用法：node scripts/build-public-assets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { resolve, join, relative } from 'path';

const REPO_ROOT = resolve(process.cwd());
const SRC_DIR = resolve(REPO_ROOT, 'assets/shared-public');
// 必须与 scripts/vite-public-assets.mjs 的 PUBLIC_ASSET_BASE 对应：/static/cdn/pub/
const OUT_DIR = resolve(REPO_ROOT, 'servers/gateway/public/static/cdn/pub');

function log(msg) { console.log(`[build-public-assets] ${msg}`); }
function die(msg) { console.error(`[build-public-assets] ERROR: ${msg}`); process.exit(1); }

/** 不发布的文件/目录：README 是给开发者看的说明，不该进 CDN */
const EXCLUDE = new Set(['README.md', '.DS_Store']);

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12);
}

/** 深度优先列出目录下所有文件（相对路径） */
function listFiles(dir, base = dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, acc);
    else acc.push(relative(base, p));
  }
  return acc;
}

function main() {
  if (!existsSync(SRC_DIR)) die(`源目录不存在: ${SRC_DIR}（资源应统一放在 assets/shared-public/）`);

  // 整目录重建：删掉旧的再拷，避免「源文件改名后在 CDN 里留僵尸文件」
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  cpSync(SRC_DIR, OUT_DIR, { recursive: true });

  // 顶层 README 不进 CDN（子目录里若有同名文件同样跳过）
  const files = listFiles(OUT_DIR).filter((rel) => !EXCLUDE.has(rel.split('/').pop()));
  // 过滤掉的不留在产物目录里（README 是仓内说明，不是 CDN 内容）
  for (const rel of listFiles(OUT_DIR)) {
    if (EXCLUDE.has(rel.split('/').pop())) rmSync(join(OUT_DIR, rel), { force: true });
  }
  if (files.length === 0) die(`源目录为空: ${SRC_DIR}`);

  const manifest = files.map((rel) => ({
    file: rel,
    url: `/static/cdn/pub/${rel.split('/').join('/')}`,
    bytes: statSync(join(OUT_DIR, rel)).size,
    sha256: sha256(join(OUT_DIR, rel)),
  }));

  writeFileSync(
    join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ base: '/static/cdn/pub/', generatedAt: new Date().toISOString(), count: manifest.length, files: manifest }, null, 2) + '\n',
  );

  const total = manifest.reduce((s, f) => s + f.bytes, 0);
  log(`${manifest.length} 个文件 → ${OUT_DIR}（${(total / 1024).toFixed(0)} KB）`);
  log(`访问前缀: /static/cdn/pub/（运行环境需已部署 cdn 目录，本地由 gateway 6000 端口托管）`);
}

main();

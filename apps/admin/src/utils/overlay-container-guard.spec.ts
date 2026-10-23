/**
 * 守卫：apps/admin 里每个 `<a-drawer>` / `<a-modal>` 必须显式挂回模块容器。
 *
 * ## 为什么需要这条守卫
 *
 * 微前端构建（`scripts/vite-micro-frontend.mjs` 的 `cssScopePlugin`）给每条 CSS 选择器加了
 * `:where([data-module="admin"])` 前缀，于是自有样式只对模块容器**内部**的 DOM 生效。
 * antd 的 Drawer / Modal 默认 teleport 到 `<body>` —— 落在容器外，抽屉外壳照旧（antd
 * cssinjs 运行时注入，不受隔离影响），但里面所有自有 class 静默失效，看起来像
 * 「卡片没了、字号退回 14px、内容贴边」。
 *
 * 这个坑**不会报错、不会构建失败**，只会「看起来有点丑」，所以必须靠静态检查兜住：
 * 2026-10-23 修好一处之后，同一症状在 11 个文件 16 处浮层里被发现，说明口头约定无效。
 *
 * 详见 `src/utils/mount.ts` 的模块注释（含实测对照表）。
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

/** apps/admin/src（本文件在 src/utils/ 下，逐级上跳即可，不依赖 cwd） */
const SRC_DIR = join(__dirname, '..');

function walkVue(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkVue(p, acc);
    else if (entry.name.endsWith('.vue')) acc.push(p);
  }
  return acc;
}

/** 从标签起点找结束的 `>`，跳过引号内的内容（属性值里可能有 `>`） */
function findTagEnd(src: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === '>') return i;
  }
  return -1;
}

/** 返回违规清单，形如 `views/Xxx.vue:12 <a-modal :open="..."` */
function findOffenders(): string[] {
  const bad: string[] = [];
  for (const file of walkVue(SRC_DIR)) {
    const src = readFileSync(file, 'utf8');
    const re = /<a-(drawer|modal)(?=[\s>])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const start = m.index;
      const lineStart = src.lastIndexOf('\n', start) + 1;
      const prefix = src.slice(lineStart, start);
      // 注释掉的标签不算
      if (prefix.includes('<!--') && !prefix.includes('-->')) continue;
      const end = findTagEnd(src, start);
      if (end < 0) continue;
      const tag = src.slice(start, end);
      re.lastIndex = end;
      if (tag.includes('get-container')) continue;
      const line = src.slice(0, start).split('\n').length;
      const head = tag.replace(/\s+/g, ' ').slice(0, 80);
      bad.push(`${relative(SRC_DIR, file)}:${line}  ${head}`);
    }
  }
  return bad;
}

describe('admin 浮层不得落到 body（微前端样式隔离）', () => {
  it('所有 a-drawer / a-modal 都显式指定 get-container', () => {
    const offenders = findOffenders();
    expect(
      offenders.length === 0
        ? ''
        : `以下浮层缺 :get-container="moduleOverlayContainer"，\n` +
            `抽屉/弹窗里的自有样式会整片失效（见 src/utils/mount.ts）：\n  ` +
            offenders.join('\n  '),
    ).toBe('');
  });

  it('守卫本身能抓到漏网的浮层（防扫描逻辑写错）', () => {
    // 直接验证扫描核心逻辑：造一段非法片段必须被判违规，合法片段必须放过。
    const sample = [
      '<a-modal :open="a" title="x">',
      '<a-drawer',
      '  :open="b"',
      '  :get-container="moduleOverlayContainer"',
      '>',
      '<!-- <a-modal :open="c"> -->',
    ].join('\n');

    const re = /<a-(drawer|modal)(?=[\s>])/g;
    const checked: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(sample))) {
      const start = m.index;
      const lineStart = sample.lastIndexOf('\n', start) + 1;
      const prefix = sample.slice(lineStart, start);
      if (prefix.includes('<!--') && !prefix.includes('-->')) continue;
      const end = findTagEnd(sample, start);
      if (end < 0) continue;
      const tag = sample.slice(start, end);
      re.lastIndex = end;
      checked.push(tag.includes('get-container') ? 'ok' : 'bad');
    }

    // 只认出一个 bad（第一行），一个 ok（多行那个），注释不掉进 checked
    expect(checked).toEqual(['bad', 'ok']);
  });
});

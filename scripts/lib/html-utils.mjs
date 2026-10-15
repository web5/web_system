/**
 * 原型整合用的 HTML / CSS 文本工具（scripts/lib/ 下共用）
 *
 * 为什么要单独抽出来：build-agents-hub.mjs 与 proto-registry.mjs 都要切 HTML 与 CSS
 * 规则块。此前两份实现各自一份 → 一旦边缘情况处理不一致（比如 storytelling 注释、
 * 嵌套花括号），呈现就会在两个来源之间分叉；这种分叉极难肉眼发现，只能靠抽 examinations。
 *
 * 纪律：这些函数是**纯文本**处理，不引入 DOM 解析器（原型是手写的静态 HTML，
 * 用正则/索引扫描更可控、出错信息更具体）。
 */

/** 取 [a, b) 区间的子串，两端找不到就报错（宁可当场炸，不要静默空串） */
export const between = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) throw new Error('找不到起点：' + a.slice(0, 40));
  const j = s.indexOf(b, i);
  if (j < 0) throw new Error('找不到终点：' + b.slice(0, 40));
  return s.slice(i, j);
};

/** 取 [a, b] 区间的子串（含终点串本身） */
export const betweenInclusive = (s, a, b) => {
  const i = s.indexOf(a);
  if (i < 0) throw new Error('找不到起点：' + a.slice(0, 40));
  const j = s.indexOf(b, i);
  if (j < 0) throw new Error('找不到终点：' + b.slice(0, 40));
  return s.slice(i, j + b.length);
};

/** 剥掉最外层开标签及其匹配闭合，只取内部（按 div 深度扫描） */
export const stripWrapper = (s, openTag) => {
  const i = s.indexOf(openTag);
  if (i < 0) throw new Error('找不到开标签：' + openTag);
  let p = i + openTag.length, depth = 1;
  while (p < s.length && depth > 0) {
    if (s.startsWith('<div', p)) { depth++; p += 4; }
    else if (s.startsWith('</div>', p)) { depth--; p += 6; }
    else p++;
  }
  if (depth !== 0) throw new Error('括号不配对：' + openTag);
  return s.slice(i + openTag.length, p - 6).trim();
};

/**
 * 从片段里只保留**完整的顶层元素**，丢掉尾部的悬空闭合标签。
 * 用途：源稿常把弹层（drawer / mask / toast）挂在内容区之外，切 [wrapper, <script>) 时
 * 尾部会多带上父容器自己的 `</div>` —— 直接拼进整合稿就 div 不配平。
 */
export const takeTopLevelElements = (s) => {
  let p = 0, depth = 0, end = 0;
  while (p < s.length) {
    if (s.startsWith('<div', p)) { depth++; p += 4; continue; }
    if (s.startsWith('<aside', p)) { depth++; p += 6; continue; }
    if (s.startsWith('</div>', p)) { depth--; p += 6; if (depth === 0) end = p; continue; }
    if (s.startsWith('</aside>', p)) { depth--; p += 8; if (depth === 0) end = p; continue; }
    p++;
  }
  return s.slice(0, end).trim();
};

/** 去掉 CSS 注释（否则 '{'/'}' 计数会被注释里的内容带偏） */
export const stripCssComments = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 按规则块粒度切 CSS（保留 selector + 声明体）。
 * 为什么不用整段追加：同名选择器重复出现时，后面的覆盖前面的，语义随拼接顺序漂移；
 * 按块去重并要求入口脚本显式决定「以谁为准」才能稳定（见 build 的「同名块以新稿为准」口径）。
 */
export const cssBlocks = (css) => {
  const out = [];
  let depth = 0, start = 0, blockStart = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') { if (depth === 0) start = blockStart; depth++; }
    else if (css[i] === '}') { depth--; if (depth === 0) { out.push(css.slice(start, i + 1)); blockStart = i + 1; } }
  }
  return out;
};

/** 取块的 selector 部分（压缩空白便于比对） */
export const selOf = (b) => b.slice(0, b.indexOf('{')).trim().replace(/\s+/g, ' ');

/**
 * 把一组 CSS 规则块**限制在指定作用域内**：每段 selector 前加 `scope `。
 *
 * 用途：合入第三方/历史原型稿时，它们的类名往往是裸通用名（.btn / .card / .table /
 * .modal …），直接合进整合稿会污染其它屏 —— 这正是 v2「样式完全是乱的」的事故类型。
 * 机械加作用域比「给类名加前缀」更安全：不动 DOM、不动 JS 里的 class 字符串拼接。
 *
 * 注意 @media 要向内递归加前缀；@keyframes / @font-face 必须保持全局（不可加前缀）；
 * `:root` 选择器会被**改写为作用域本身**（源稿的私有变量只在该屏子树生效，不外泄成全局 token）。
 */
export const scopeCssBlocks = (blocks, scope) => {
  const prefix = (sel, inner) => (inner ? sel : sel.split(',').map((s) => `${scope} ${s.trim()}`).join(',\n  '));
  return blocks.map((b) => {
    const open = b.indexOf('{');
    const sel = b.slice(0, open).trim().replace(/\s+/g, ' ');
    const body = b.slice(open);
    if (/^@keyframes/i.test(sel) || /^@font-face/i.test(sel)) return b;
    if (/^@media/i.test(sel)) {
      const inner = cssBlocks(body.slice(1, body.lastIndexOf('}')));
      return `${sel}{\n  ${scopeCssBlocks(inner, scope).join('\n  ')}\n  }`;
    }
    // 源稿私有变量：:root 改成作用域选择器（否则 --primary 之类会变成全局 token，污染全站）
    if (/^:root$/i.test(sel)) return `${scope}${body}`;
    return `${prefix(sel, false)}{\n  ${body.slice(1, body.lastIndexOf('}')).trim()}\n  }`;
  });
};

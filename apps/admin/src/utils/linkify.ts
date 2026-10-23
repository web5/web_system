/**
 * 把 HTML 正文里「裸 URL」染成可点链接（#433）。
 *
 * 为什么在渲染层做，而不是修数据：成文预览的 stored 分支直传 `payload.html`，
 * 那是**发布当时**渲染好的产物。渲染器后来修的裸 URL 链接化（#399）对它完全无效，
 * 于是 2026-10-23 之前落库的记录点开永远是纯文本。#431 的「重建成文」能修，
 * 但那是人工动作（要发现按钮、要有权限、要逐条点）。这里改为渲染时兜底：
 * 数据脏不脏都保证显示正确，存量一次性全好。
 *
 * 与 `servers/content-hub` 里 `render.ts` 的 `BARE_URL` 分工不同，别互相替代：
 *   - 后端那份在**生成** HTML 时链接化，产物会发到公众号，必须干净；
 *   - 这份在**显示**已存 HTML 时兜底，只管后台预览。
 *
 * 为什么用 DOMParser 而不是对整串跑正则：正则必须手写 `(?<!")` 之类去躲
 * `href="https://…"`，稍不留神就嵌套出 `<a><a>`。遍历文本节点时属性值根本
 * 不在候选范围内，这类坑从结构上不存在。
 */

/**
 * URL 体内的排除项，每一处都对应真实串：
 *   - `\s < >` 空白与标签边界
 *   - `" '` 引号（文本节点里少见，防御性保留）
 *   - `\u3000-\u303f` 中日韩标点、`\uff00-\uffef` 全角符号
 *     —— `https://a.com/x，后面还有中文` 若不排除，整句会被吞成一个链接
 */
const URL_RE = /https?:\/\/[^\s<>"'\u3000-\u303f\uff00-\uffef]+/g;

/** URL 末尾被误吞的标点（半角 + 中文全角都算，它们不属于 URL） */
const TRAILING_PUNCT = /[),.;:!?，。；：！？、）】》」』…]+$/;

/** 这些标签内部不处理：链接会嵌套、代码要原样 */
const SKIP_SELECTOR = 'a, code, pre';

/** 文本节点 → 拆成「文本 + <a> + 文本」的片段 */
function linkifyTextNode(node: Text): boolean {
  const text = node.nodeValue ?? '';
  if (!text || !text.includes('http')) return false;

  const doc = node.ownerDocument;
  if (!doc) return false;

  const frag = doc.createDocumentFragment();
  let last = 0;
  let changed = false;

  // 全局正则有 lastIndex 状态，复用前必须归零
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    let url = m[0];
    const tail = url.match(TRAILING_PUNCT)?.[0] ?? '';
    if (tail) url = url.slice(0, -tail.length);
    // 只剩协议（`https://。`）不产出空链接
    if (url.length <= (url.startsWith('https://') ? 8 : 7)) continue;

    if (m.index > last) {
      frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
    }

    const a = doc.createElement('a');
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    // 预览里的外链一律新窗口 + 断 opener，避免被跳走丢掉后台登录态
    a.setAttribute('rel', 'noopener noreferrer');
    a.textContent = url;
    frag.appendChild(a);

    last = m.index + url.length;
    changed = true;
  }

  if (!changed) return false;
  if (last < text.length) {
    frag.appendChild(doc.createTextNode(text.slice(last)));
  }
  node.parentNode?.replaceChild(frag, node);
  return true;
}

/**
 * 把 HTML 里文本节点中的裸 URL 转成 `<a>`；已在链接/代码内的不动。
 *
 * 幂等：第二次调用时 URL 都躺在 `<a>` 里，被 SKIP_SELECTOR 跳过，输出不变。
 * 没有 `http` 字样时直接返回原串，连 DOM 都不建。
 */
export function linkifyHtml(html: string | null | undefined): string {
  if (!html || !html.includes('http')) return html ?? '';
  if (typeof DOMParser === 'undefined') return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);

  // 先收集再改：边走边替换会让 TreeWalker 的位置失效
  const targets: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const el = (node as Text).parentElement;
    if (el && !el.closest(SKIP_SELECTOR) && node.nodeValue?.includes('http')) {
      targets.push(node as Text);
    }
    node = walker.nextNode();
  }

  let touched = false;
  for (const t of targets) {
    if (linkifyTextNode(t)) touched = true;
  }
  return touched ? doc.body.innerHTML : html;
}

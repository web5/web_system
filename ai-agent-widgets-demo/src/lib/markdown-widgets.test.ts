import { describe, it, expect } from 'vitest';
import {
  WIDGET_PENDING_HTML,
  decodeProps,
  encodeProps,
  isAllowedApp,
  parseWidgetSpec,
  slotAttributes,
  slotHtml,
  WIDGET_REGISTRY,
} from './widget-protocol';
import { renderMarkdown, isWidgetFence } from './markdown';
import {
  isWidgetPending,
  reconcileBlocks,
  splitWidgetBlocks,
  type MdBlock,
} from './markdown-blocks';
import { splitRenderable, isCodeFenceOpen } from '@/composables/useStreaming';

const POLL = {
  app: 'poll',
  props: {
    question: '选一个实现方案',
    options: ['自研 StreamingMarkdown', '引 bytemd', '引 Vercel AI SDK'],
  },
};
const fence = (json: string) => '```widget\n' + json + '\n```\n';

// ---------------------------------------------------------------------------
// 协议 / 白名单 / XSS
// ---------------------------------------------------------------------------
describe('widget 协议：白名单与解析容错', () => {
  it('合法声明解析出 WidgetSpec { app, props, raw }', () => {
    const raw = JSON.stringify(POLL);
    const spec = parseWidgetSpec(raw);
    expect(spec).not.toBeNull();
    expect(spec!.app).toBe('poll');
    expect(spec!.props.question).toBe('选一个实现方案');
    expect(spec!.raw).toBe(raw);
  });

  it('流式半截 JSON 不抛错，返回 null', () => {
    expect(parseWidgetSpec('{"app":"poll","props":{"question":"选一个')).toBeNull();
    expect(parseWidgetSpec('```widget')).toBeNull();
    expect(parseWidgetSpec('')).toBeNull();
    expect(() => parseWidgetSpec('{oops')).not.toThrow();
  });

  it('app 不在白名单（含任意 URL）一律拒绝 —— 防 prompt injection 动态 import', () => {
    expect(parseWidgetSpec(JSON.stringify({ app: 'evil', props: {} }))).toBeNull();
    expect(
      parseWidgetSpec(JSON.stringify({ app: 'https://evil.example/x.js', props: {} })),
    ).toBeNull();
    expect(parseWidgetSpec(JSON.stringify({ app: '../secrets', props: {} }))).toBeNull();
    expect(isAllowedApp('poll')).toBe(true);
    expect(isAllowedApp('constructor')).toBe(false);
    expect(isAllowedApp('__proto__')).toBe(false);
    for (const app of Object.keys(WIDGET_REGISTRY)) expect(isAllowedApp(app)).toBe(true);
  });

  it('props 非对象 / 含原型污染键被清理', () => {
    expect(parseWidgetSpec(JSON.stringify({ app: 'poll', props: 'x' }))).toBeNull();
    expect(parseWidgetSpec(JSON.stringify({ app: 'poll', props: [1, 2] }))).toBeNull();
    const spec = parseWidgetSpec(
      '{"app":"poll","props":{"__proto__":{"polluted":1},"constructor":"x","ok":"yes"}}',
    );
    expect(spec).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(spec!.props, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(spec!.props, 'constructor')).toBe(false);
    expect(spec!.props.ok).toBe('yes');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('props 用 base64 编码进属性，不拼 HTML；中文可无损往返', () => {
    const spec = parseWidgetSpec(JSON.stringify(POLL))!;
    const attrs = slotAttributes(spec);
    expect(attrs.app).toBe('poll');
    expect(attrs.props).not.toContain('<');
    expect(attrs.props).not.toContain('"');
    expect(decodeProps(attrs.props)).toEqual(POLL.props);
    expect(encodeProps({ 中文: '引号 " 与 <标签>' })).not.toContain('<');
  });

  it('恶意 props 不会逃逸出 data-* 属性', () => {
    const spec = parseWidgetSpec(
      JSON.stringify({ app: 'poll', props: { x: '"><script>alert(1)</script>' } }),
    )!;
    const html = slotHtml(spec);
    expect(html).toContain('class="mf-slot"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('data-props="');
    expect(decodeProps(slotAttributes(spec).props).x).toBe('"><script>alert(1)</script>');
  });
});

// ---------------------------------------------------------------------------
// markdown-it 自定义 fence rule
// ---------------------------------------------------------------------------
describe('markdown-it widget fence rule', () => {
  it('info === widget 输出 mf-slot 挂载点，而不是代码块', () => {
    const html = renderMarkdown('前文\n\n' + fence(JSON.stringify(POLL)));
    expect(html).toContain('class="mf-slot"');
    expect(html).toContain('data-app="poll"');
    expect(html).toContain('data-props="');
    expect(html).toContain('前文');
    expect(html).not.toContain('<pre><code class="language-widget"');
  });

  it('半截 / 非法 JSON 输出「⏳ 组件加载中…」占位，绝不抛错', () => {
    const html = renderMarkdown(fence('{"app":"poll","props":{"question":"半截'));
    expect(html).toContain('⏳ 组件加载中…');
    expect(html).toContain(WIDGET_PENDING_HTML.slice(0, 20));
    expect(() => renderMarkdown(fence('{oops'))).not.toThrow();
  });

  it('非白名单 app（任意 URL）落到占位，不产生 import / 任意 URL', () => {
    const html = renderMarkdown(
      fence(JSON.stringify({ app: 'https://evil.example/x.js', props: {} })),
    );
    expect(html).toContain('⏳ 组件加载中…');
    expect(html).not.toContain('evil.example');
  });

  it('普通 fence 仍走 highlight.js', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    expect(html).toContain('<pre><code');
    expect(html).toContain('language-ts');
    expect(html).toContain('hljs-keyword');
  });

  it('isWidgetFence 只认 info 首词', () => {
    expect(isWidgetFence('widget')).toBe(true);
    expect(isWidgetFence(' widget  foo')).toBe(true);
    expect(isWidgetFence('ts')).toBe(false);
    expect(isWidgetFence('widget-json')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 稳定 block 切分（核心：不销毁已挂载子应用）
// ---------------------------------------------------------------------------
describe('稳定 block 切分 / 半截容错 / 稳定 id', () => {
  const doc =
    '开头正文。\n\n' +
    fence(JSON.stringify(POLL)) +
    '\n后面的文字继续。\n\n' +
    '```ts\nconst a = 1;\n```\n';

  it('完整 widget 切出独立 block，前后各一个文本块', () => {
    const blocks = splitWidgetBlocks(doc);
    expect(blocks.map((b) => b.kind)).toEqual(['md', 'widget', 'md']);
    expect(blocks[1].id).toBe('w:poll:1');
    expect(blocks[0].id).toBe('m:0');
  });

  it('普通 ```ts 代码块留在 md 块内，不被误判成 widget', () => {
    const blocks = splitWidgetBlocks(doc);
    const last = blocks[blocks.length - 1];
    expect(last.kind).toBe('md');
    expect((last as { src: string }).src).toContain('```ts');
    expect(blocks.filter((b) => b.kind === 'widget')).toHaveLength(1);
  });

  it('后续 token 只让最后一个文本块变化，前面的 block id 与对象引用都不变', () => {
    const before = reconcileBlocks(doc, []);
    const after = reconcileBlocks(doc + '继续追加的 token。', before);
    expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));
    expect(after[0]).toBe(before[0]); // 文本块对象复用
    expect(after[1]).toBe(before[1]); // 🔴 widget 块对象复用 -> Vue 不重建组件
    expect(after[2]).not.toBe(before[2]); // 只有最后文本块更新
  });

  it('同一 app 出现两次 -> 稳定出现序号 w:poll:1 / w:poll:2', () => {
    const twice = fence(JSON.stringify(POLL)) + '\n之间\n\n' + fence(JSON.stringify(POLL));
    const widgets = splitWidgetBlocks(twice).filter((b) => b.kind === 'widget');
    expect(widgets.map((b) => b.id)).toEqual(['w:poll:1', 'w:poll:2']);
  });

  it('闭合但 JSON 非法 -> widget-invalid 占位块，不抛错', () => {
    const blocks = splitWidgetBlocks(fence('{"app":"poll","props":'));
    expect(blocks.some((b) => b.kind === 'widget-invalid')).toBe(true);
    expect(() => splitWidgetBlocks(fence('{oops'))).not.toThrow();
  });

  it('流式半截 widget fence 被 splitRenderable 拦在 pending，safe 不产生挂点', () => {
    const half = '正文前面\n\n```widget\n{"app":"poll","props":{"question":"半截';
    const split = splitRenderable(half);
    expect(isCodeFenceOpen(half)).toBe(true);
    expect(split.hasUnclosed).toBe(true);
    expect(split.safe).not.toContain('```widget');
    expect(split.pending).toContain('```widget');
    expect(isWidgetPending(split.pending)).toBe(true);
    const blocks: MdBlock[] = splitWidgetBlocks(split.safe);
    expect(blocks.every((b) => b.kind === 'md')).toBe(true);
    expect(() => splitWidgetBlocks(split.safe)).not.toThrow();
  });

  it('闭合后 widget 才出现（不会在半截时提前 System.import）', () => {
    const half = '正文\n\n```widget\n{"app":"poll"';
    expect(splitWidgetBlocks(splitRenderable(half).safe).some((b) => b.kind === 'widget')).toBe(
      false,
    );
    const full = half + '}\n```\n后面正文\n';
    const blocks = splitWidgetBlocks(splitRenderable(full).safe);
    expect(blocks.filter((b) => b.kind === 'widget')).toHaveLength(1);
    expect(blocks.some((b) => b.kind === 'md' && b.src.includes('后面正文'))).toBe(true);
  });
});

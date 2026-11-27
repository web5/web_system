import { describe, it, expect } from 'vitest';
import { isCodeFenceOpen, splitRenderable } from './useStreaming';

describe('useStreaming 未闭合代码块检测', () => {
  it('闭合代码块 -> 未打开', () => {
    expect(isCodeFenceOpen('```ts\nconst a = 1;\n```')).toBe(false);
  });

  it('只来半个 fence -> 打开', () => {
    expect(isCodeFenceOpen('```ts\nconst a = 1;')).toBe(true);
  });

  it('多块交替，最后闭合 -> 未打开', () => {
    const md = '前\n\n```a\nx\n```\n\n中\n\n```b\ny\n```\n';
    expect(isCodeFenceOpen(md)).toBe(false);
  });

  it('多块交替，最后一个未闭合 -> 打开', () => {
    const md = '前\n\n```a\nx\n```\n\n中\n\n```b\ny';
    expect(isCodeFenceOpen(md)).toBe(true);
  });

  it('splitRenderable：未闭合时把整段代码块放入 pending', () => {
    const r = splitRenderable('你好\n\n```ts\nconst a =');
    expect(r.hasUnclosed).toBe(true);
    expect(r.safe).toBe('你好\n');
    expect(r.pending).toContain('```ts');
    expect(r.pending).toContain('const a =');
  });

  it('splitRenderable：闭合后整段可渲染', () => {
    const r = splitRenderable('你好\n\n```ts\nconst a = 1;\n```');
    expect(r.hasUnclosed).toBe(false);
    expect(r.safe).toContain('```ts');
    expect(r.safe).toContain('const a = 1;');
    expect(r.pending).toBe('');
  });

  it('splitRenderable：纯文本无 pending', () => {
    const r = splitRenderable('普通段落，没有代码块。');
    expect(r.hasUnclosed).toBe(false);
    expect(r.safe).toBe('普通段落，没有代码块。');
  });
});

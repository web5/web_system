/// <reference types="node" />
/**
 * 【测试工程师 · 独立盲测用例】公共层（切词 / 查表）口径 + 需求① 逐句换行的静态判据
 *
 * 说明（为什么这么写）：
 *  - 本文件由测试角色独立构造，**不是**开发提交的用例，只按用户口述需求与已拍板口径下断言；
 *  - R3 查表逻辑本次从 detail.ts 抽到 utils/lexicon.ts，抽屉式重构最大的风险是「规则被悄悄改弱」。
 *    故这里把**改动前**的实现（git 908014bf^ 的 _lookupWord）原样复制成 oldLookup，
 *    用同一份语料逐个词与新 utils/lexicon.lookupWord 对比：任何一处行为漂移都会红。
 *  - 沉浸档换行是 CSS 判据，机器门里没有真机渲染，只能做「选择器 + 声明」的静态判定，
 *    这一点在报告里标注为「静态判定，真机未执行」。
 */
import * as fs from 'fs';
import * as path from 'path';
import { tokenize, buildKnown } from '../utils/tokenize';
import { lookupWord } from '../utils/lexicon';
import type { NceWord } from '../services/nce';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** 去掉 CSS 注释，避免注释里的示例选择器误判 */
const stripCss = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

describe('V7 切词：撇号 / 连字符 / 标点 / 空串（反例：don\u2019t、It\u2019s、well-known）', () => {
  it("缩写 don't 应为一个词，不当成 don + ' + t", () => {
    const t = tokenize("I don't know.", {});
    expect(t.map((x) => x.t)).toEqual(['I', ' ', "don't", ' ', 'know', '.']);
    expect(t.filter((x) => x.w).map((x) => x.w)).toEqual(['i', "don't", 'know']);
  });

  it('弯撇号 It’s 同样作为一个词（U+2019）', () => {
    const t = tokenize('It\u2019s fine.', {});
    expect(t.filter((x) => x.w).map((x) => x.w)).toEqual(['it\u2019s', 'fine']);
  });

  it('连字符拆成 词-符号-词（token 拼接后必须原样还原句子）', () => {
    const en = 'A well-known fact.';
    const t = tokenize(en, {});
    expect(t.map((x) => x.t).join('')).toBe(en);
    expect(t.filter((x) => x.w).map((x) => x.w)).toEqual(['a', 'well', 'known', 'fact']);
  });

  it('首字母大写保留展示原文、查词用小写', () => {
    const t = tokenize('The End', {});
    expect(t[0].t).toBe('The');
    expect(t[0].w).toBe('the');
  });

  it('空串 / null / undefined 不抛异常且返回空数组', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(undefined as unknown as string)).toEqual([]);
    expect(tokenize(null as unknown as string)).toEqual([]);
  });

  it('hasDef 只认词表直收的原形（大小写不敏感），变形不算直收', () => {
    const known = buildKnown([{ word: 'Play' }, { word: 'the' }]);
    const t = tokenize('The player plays.', known);
    const byW: Record<string, boolean> = {};
    t.filter((x) => x.w).forEach((x) => { byW[x.w] = x.hasDef; });
    expect(byW.the).toBe(true);
    expect(byW.player).toBe(false);
    expect(byW.plays).toBe(false);
  });

  it('buildKnown 对 null / 空 / 脏项容错', () => {
    expect(buildKnown(null)).toEqual({});
    expect(buildKnown(undefined)).toEqual({});
    expect(buildKnown([])).toEqual({});
    expect(buildKnown([{ word: '' }, {}, { word: 'Hi' }])).toEqual({ hi: true });
  });
});

describe('R3 查表：抽取前后行为必须逐词一致（防「规则被改弱」）', () => {
  /** 改动前实现（来自 git 908014bf^ pages/nce/detail/detail.ts 的 _lookupWord 本体） */
  function oldLookup(w: string, words: NceWord[]): any {
    const byKey = (k: string): NceWord | undefined =>
      words.find((x) => String(x.word).toLowerCase() === k);
    const IRREG: Record<string, string> = {
      has: 'have', have: 'have', had: 'have',
      been: 'be', is: 'be', am: 'be', are: 'be', was: 'be', were: 'be',
      does: 'do', do: 'do', did: 'do',
      gone: 'go', went: 'go',
      received: 'receive',
    };
    let stem = w;
    if (/ies$/.test(stem)) stem = stem.replace(/ies$/, 'y');
    else if (/(ches|shes|sses|xes)$/.test(stem)) stem = stem.replace(/es$/, '');
    else if (/ied$/.test(stem)) stem = stem.replace(/ied$/, 'y');
    else if (/ed$/.test(stem)) stem = stem.replace(/ed$/, '');
    else if (/ing$/.test(stem)) stem = stem.replace(/ing$/, '');
    else if (/s$/.test(stem) && !/ss$/.test(stem)) stem = stem.replace(/s$/, '');
    const lemma = IRREG[w] || stem;
    const candidates = [w, lemma, lemma + 'e', w.replace(/s$/, ''), lemma + 's'];
    for (const c of candidates) {
      const hit = byKey(c);
      if (hit) {
        return {
          word: hit.word, phonetic: hit.phonetic, pos: hit.pos,
          def: hit.def, example: hit.example, none: false,
        };
      }
    }
    return { word: w, none: true };
  }

  const WORDS: NceWord[] = [
    { word: 'play', def: '玩' }, { word: 'study', def: '学习' }, { word: 'watch', def: '观看' },
    { word: 'wash', def: '洗' }, { word: 'box', def: '盒子' }, { word: 'dance', def: '跳舞' },
    { word: 'smile', def: '微笑' }, { word: 'make', def: '制作' }, { word: 'run', def: '跑' },
    { word: 'city', def: '城市' }, { word: 'pass', def: '通过' }, { word: 'miss', def: '想念' },
    { word: 'stop', def: '停止' }, { word: 'the', def: '这' }, { word: 'have', def: '有' },
    { word: 'be', def: '是' }, { word: 'do', def: '做' }, { word: 'go', def: '去' },
    { word: 'receive', def: '收到' }, { word: 'refuse', def: '拒绝' }, { word: 'worry', def: '担心' },
    { word: 'carry', def: '携带' }, { word: 'fix', def: '修理' }, { word: 'push', def: '推' },
  ];

  const CORPUS = [
    'play', 'plays', 'played', 'playing',
    'study', 'studies', 'studied', 'studyed',
    'watch', 'watches', 'watched', 'watching',
    'wash', 'washes', 'washed', 'washing',
    'box', 'boxes', 'dance', 'dances', 'danced', 'dancing',
    'smile', 'smiles', 'smiled', 'smiling',
    'make', 'makes', 'made', 'making',
    'run', 'runs', 'ran', 'running',
    'city', 'cities', 'pass', 'passes', 'passed', 'passing',
    'miss', 'misses', 'missed', 'stop', 'stops', 'stopped', 'stopping',
    'the', 'have', 'has', 'had', 'is', 'am', 'are', 'was', 'were', 'been',
    'do', 'does', 'did', 'go', 'goes', 'went', 'gone',
    'receive', 'received', 'refuse', 'refuses', 'refused', 'refusing',
    'worry', 'worries', 'worried', 'worrying',
    'carry', 'carries', 'carried', 'fix', 'fixes', 'fixed', 'fixing',
    'push', 'pushes', 'pushed', 'pushing',
    'unknownword', 'xyz', 'a', 'i',
  ];

  it('语料 80+ 词逐个与旧实现完全一致', () => {
    const diffs: string[] = [];
    CORPUS.forEach((w) => {
      const a = JSON.stringify(oldLookup(w, WORDS));
      const b = JSON.stringify(lookupWord(w, WORDS));
      if (a !== b) diffs.push(`${w}: old=${a} new=${b}`);
    });
    expect(diffs).toEqual([]);
  });

  it('空词表 / null 词表一律「暂无释义」且不抛', () => {
    expect(lookupWord('the', []).none).toBe(true);
    expect(lookupWord('the', null).none).toBe(true);
    expect(lookupWord('', WORDS).none).toBe(true);
    expect(lookupWord('', WORDS).word).toBe('');
  });

  it('R3 已知能力边界：辅音双写 -ing（running→run）查不到，属封闭规则表既有约定', () => {
    // 这条不是缺陷，是把「规则表不扩充」的既有边界钉住，避免后续被当成回归
    expect(lookupWord('running', WORDS).none).toBe(true);
    expect(lookupWord('stopped', WORDS).none).toBe(true);
  });

  it('大写输入（The）新实现能查到 —— 相对旧实现的**增强**，不改口径', () => {
    expect(lookupWord('The', WORDS).none).toBe(false);
    expect(lookupWord('The', WORDS).word).toBe('the');
  });
});

describe('V1/V3/V5 需求①：沉浸档逐句换行的 CSS 判据（静态，真机未执行）', () => {
  const css = stripCss(read('pages/nce/detail/detail.wxss'));

  /** 取「最后一条命中该选择器块」的某属性值（CSS 级联：同权重后者覆盖前者） */
  function lastDecl(selector: string, prop: string): string | null {
    const blocks = css.split('}');
    let val: string | null = null;
    blocks.forEach((b) => {
      const parts = b.split('{');
      if (parts.length < 2) return;
      const sels = parts[0].split(',').map((s) => s.trim());
      if (!sels.includes(selector)) return;
      const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`);
      const m = re.exec(parts[1]);
      if (m) val = m[1].trim();
    });
    return val;
  }

  it('沉浸档 .sent 必须是 block（inline 连排已改掉）', () => {
    expect(lastDecl('.mode-immersion .sentences .sent', 'display')).toBe('block');
  });

  it('沉浸档 .sline / .stx / .en 必须是 block（inline 会造成「同一行内多句拼接」）', () => {
    expect(lastDecl('.mode-immersion .sentences .sline', 'display')).toBe('block');
    expect(lastDecl('.mode-immersion .sentences .stx', 'display')).toBe('block');
    expect(lastDecl('.mode-immersion .sentences .en', 'display')).toBe('block');
  });

  it('V3 句序号隐藏只挂在沉浸档作用域，不得影响点按/双语档', () => {
    const hiddenSn = css
      .split('}')
      .filter((b) => /\.sn[^{]*\{[^}]*display\s*:\s*none/.test(`${b}}`))
      .map((b) => b.split('{')[0].trim());
    // 允许空数组；只要出现，选择器必须带 .mode-immersion
    hiddenSn.forEach((sel) => expect(sel).toContain('.mode-immersion'));
  });

  it('V3 点按/双语档的 .sent 基础声明仍是 block（未被沉浸档规则连带改动）', () => {
    expect(lastDecl('.sent', 'display')).toBe('block');
  });

  it('V5 承载参考译文的 .cn-fold-c 必须有 white-space: pre-wrap（否则 \\n 被折叠）', () => {
    expect(lastDecl('.cn-fold-c', 'white-space')).toBe('pre-wrap');
  });

  it('V8 不存在无作用域的 .w:active 按下高亮；.w.hit 死类已删', () => {
    expect(/\.w:active\s*\{/.test(css)).toBe(false);
    expect(/\.w\.hit/.test(css)).toBe(false);
    expect(/\.w\.has-def:active\s*\{/.test(css)).toBe(true);
  });
});

describe('V7 需求②：非生词节点不得挂任何事件（WXML 静态判据）', () => {
  const wxml = read('pages/nce/detail/detail.wxml');

  it('生词节点同时挂 catchtap + catchlongpress，且条件里含 hasDef', () => {
    const m = /<text[^>]*catchtap="onWordTap"[^>]*>/.exec(wxml);
    expect(m).not.toBeNull();
    const tag = (m as RegExpExecArray)[0];
    expect(tag).toContain('catchlongpress="onWordLongPress"');
    expect(tag).toContain('{{tk.w && tk.hasDef}}');
  });

  it('else 分支是纯文本 text，不带任何事件属性', () => {
    const m = /<text wx:else>([^<]*)<\/text>/.exec(wxml);
    expect(m).not.toBeNull();
  });

  it('全文只有 1 处 catchtap="onWordTap"（非生词不得复用同一事件）', () => {
    expect(wxml.split('catchtap="onWordTap"').length - 1).toBe(1);
  });
});

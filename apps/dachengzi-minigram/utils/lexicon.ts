/**
 * 点词释义查表（课文详情页 / 首页今日一句共用）
 *
 * 2026-11-26 从 pages/nce/detail/detail.ts 的 _lookupWord 抽出：首页今日一句也要出词卡，
 * 两处必须共用同一套 R3 封闭规则表，否则同一个词在详情页能查到、在首页查不到。
 *
 * R3 封闭规则表（02 §1.4 :110-118，实现期不得扩充）：
 * R3-1 小写化 → R3-2 -s/-es → R3-3 -ed → R3-4 -ing → R3-5 不规则词封闭枚举
 * → R3-6 候选集固定顺序 [w, 词元, 词元+'e', w去s, 词元+'s'] 查词汇表，
 * 首个命中即返回该词条；全部未命中一律「暂无释义」。
 */
import type { NceWord } from '../services/nce';

/** 词卡渲染视图（与 services/nce 的 NceWord 解耦：字段缺失即省略）。 */
export interface WordLookup {
  word: string;
  phonetic?: string;
  pos?: string;
  def?: string;
  example?: string;
  /** 课表外词：暂无释义 */
  none: boolean;
}

/** R3-5 不规则词封闭枚举（映射后仍查词汇表，不得扩充） */
const IRREG: Record<string, string> = {
  has: 'have', have: 'have', had: 'have',
  been: 'be', is: 'be', am: 'be', are: 'be', was: 'be', were: 'be',
  does: 'do', do: 'do', did: 'do',
  gone: 'go', went: 'go',
  received: 'receive',
};

/** 查词：命中返回词条，未命中返回 { word, none: true }。 */
export function lookupWord(raw: string, words: ReadonlyArray<NceWord> | null | undefined): WordLookup {
  const w = String(raw || '').toLowerCase();
  const list = words || [];
  const byKey = (k: string): NceWord | undefined =>
    list.find((x) => String(x.word).toLowerCase() === k);
  if (!w) return { word: '', none: true };

  // R3-2 / R3-3 / R3-4 词形还原（单一词元）
  let stem = w;
  if (/ies$/.test(stem)) stem = stem.replace(/ies$/, 'y');
  else if (/(ches|shes|sses|xes)$/.test(stem)) stem = stem.replace(/es$/, '');
  else if (/ied$/.test(stem)) stem = stem.replace(/ied$/, 'y');
  else if (/ed$/.test(stem)) stem = stem.replace(/ed$/, '');
  else if (/ing$/.test(stem)) stem = stem.replace(/ing$/, '');
  else if (/s$/.test(stem) && !/ss$/.test(stem)) stem = stem.replace(/s$/, '');

  const lemma = IRREG[w] || stem;
  // R3-6 候选集固定顺序
  const candidates = [w, lemma, lemma + 'e', w.replace(/s$/, ''), lemma + 's'];
  for (const c of candidates) {
    const hit = byKey(c);
    if (hit) {
      return {
        word: hit.word,
        phonetic: hit.phonetic,
        pos: hit.pos,
        def: hit.def,
        example: hit.example,
        none: false,
      };
    }
  }
  // 表外词：暂无释义且保留可点
  return { word: w, none: true };
}

/**
 * 翻译输出解析（portal 对话翻译卡 + 小程序翻译结果页共用）。
 * 契约出参：【推荐译文】/【直译对照】/【委婉版】/【语气要点】。
 */

/** 出参段落标题（顺序即渲染顺序） */
export const TRANSLATE_SECTION_TITLES = ['推荐译文', '直译对照', '委婉版', '语气要点'] as const;

export type TranslateSectionTitle = (typeof TRANSLATE_SECTION_TITLES)[number];

/** 按标题切分 agent 输出；一个标题都没命中时返回空对象 */
export function parseSections(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const marks: Array<{ key: string; start: number }> = [];
  for (const t of TRANSLATE_SECTION_TITLES) {
    const idx = text.indexOf(`【${t}】`);
    if (idx >= 0) marks.push({ key: t, start: idx });
  }
  marks.sort((a, b) => a.start - b.start);
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].start + `【${marks[i].key}】`.length;
    const to = i + 1 < marks.length ? marks[i + 1].start : text.length;
    out[marks[i].key] = text.slice(from, to).trim();
  }
  return out;
}

/** 流式过程中还没凑齐段落时，去掉【标题】直接展示已收到的正文 */
export function stripTitles(text: string): string {
  return (text || '').replace(/【[^】]*】/g, '').trim();
}

/**
 * 历史消息「翻译官回复」启发式补判（取小程序严谨版，portal 原版较宽松已收敛）：
 * 满足其一：含【推荐译文】四段契约；或「句首英文 + 后面中文 + 首段含 ≥2 连续字母」
 * （排除「A 股」「OK 了」这类误判）。纯中文 / 纯英文 / 代码块均不命中。
 */
export function looksLikeTranslateReply(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.indexOf('【推荐译文】') >= 0) return true;
  if (!/^[A-Za-z]/.test(t)) return false;
  const idx = t.search(/[\u4e00-\u9fa5]/);
  if (idx < 0) return false;
  return /[A-Za-z]{2,}/.test(t.slice(0, idx));
}

/** portal 翻译卡片方向文案：从提问推断，推断不出给「翻译结果」兜底（对话翻译卡 dir 字段用） */
export function inferDirection(question?: string): string {
  if (!question) return '翻译结果';
  if (/(翻译|译)成.{0,6}英(语|文)/.test(question) || /英(语|文)怎么(说|讲)/.test(question)) return '中文 → 英语';
  if (/(翻译|译)成.{0,6}日(语|文|本)/.test(question)) return '中文 → 日语';
  if (/(翻译|译)成.{0,6}德(语|文)/.test(question)) return '中文 → 德语';
  if (/(翻译|译)成.{0,6}中(文|语)/.test(question)) return '英语 → 中文';
  return '翻译结果';
}

/** 目标语言关键词 → 展示名（小程序翻译结果页用，顺序影响匹配优先级） */
const LANG_WORDS: Array<{ key: string; words: string[] }> = [
  { key: '英语', words: ['英语', '英文'] },
  { key: '日语', words: ['日语', '日文'] },
  { key: '韩语', words: ['韩语', '韩文'] },
  { key: '法语', words: ['法语', '法文'] },
  { key: '德语', words: ['德语', '德文'] },
  { key: '西语', words: ['西班牙语', '西语'] },
  { key: '俄语', words: ['俄语', '俄文'] },
  { key: '泰语', words: ['泰语', '泰文'] },
  { key: '中文', words: ['中文', '汉语', '汉字'] },
];

/** 小程序翻译方向推断：从提问推断「中文 → 英语」等；推断不出返回空串（调用方据此不渲染 meta，不猜不留白） */
export function inferTranslateDirection(question: string): string {
  const q = String(question || '');
  const hits: Array<{ key: string; idx: number }> = [];
  for (const lang of LANG_WORDS) {
    let idx = -1;
    for (const w of lang.words) {
      const i = q.indexOf(w);
      if (i >= 0 && (idx < 0 || i < idx)) idx = i;
    }
    if (idx >= 0) hits.push({ key: lang.key, idx });
  }
  if (!hits.length) return '';
  hits.sort((a, b) => a.idx - b.idx);
  const last = hits[hits.length - 1];
  // 最后提到的语种是中文 → 目标语是中文，源语取前一个（没有则默认英语）
  if (last.key === '中文') {
    const src = hits.length > 1 ? hits[hits.length - 2].key : '英语';
    return `${src} → 中文`;
  }
  return `中文 → ${last.key}`;
}

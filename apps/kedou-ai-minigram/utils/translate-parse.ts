/**
 * 翻译输出解析（翻译结果页 + 主对话卡片共用）
 *
 * 契约（与 specs/kedou-ai-minigram/agent-translate.sql 的 systemPrompt 对齐）：
 *   出参：【推荐译文】/【直译对照】/【委婉版】/【语气要点】
 *
 * 两个消费方：
 *   - 翻译结果页：四段分别落字段；
 *   - 主对话：只取「推荐译文」作英文主文，其余合并为中文注解（流式与完成态用同一套算法，
 *     保证 T1 → T2 平滑过渡，不出现排版跳变）。
 */
/** 出参段落标题（顺序即渲染顺序） */
export const TRANSLATE_SECTION_TITLES = ['推荐译文', '直译对照', '委婉版', '语气要点'];

/** 注解段（推荐译文之外的段落，合并进卡片注解区） */
const NOTE_KEYS = ['直译对照', '委婉版', '语气要点'];

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

/** 流式过程中还没凑齐段落时，去掉标题直接展示已收到的正文 */
export function stripTitles(text: string): string {
  return text.replace(/【[^】]*】/g, '').trim();
}

export interface CardView {
  /** 英文主文 */
  main: string;
  /** 中文注解（无则空串） */
  note: string;
  /** 去掉标题后的整段正文（长按复制 / 失败态保留用） */
  text: string;
}

/**
 * 把一段 agent 输出整理成卡片视图。
 *
 * - 命中段落标题 → 推荐译文为主文，其余段落按行合并为注解；
 * - 没命中（通用对话里翻译官常直接给一句英文 + 中文说明）→ 按「首个中文字符」切一次：
 *   句首的拉丁段为主文，其后为注解；句首没有英文则整段进主文。
 */
export function buildTranslateCardView(raw: string): CardView {
  const sections = parseSections(raw);
  if (Object.keys(sections).length > 0) {
    return {
      main: sections['推荐译文'] || stripTitles(raw),
      note: NOTE_KEYS.map((k) => sections[k]).filter(Boolean).join('\n'),
      text: stripTitles(raw),
    };
  }
  const text = stripTitles(raw);
  const { main, note } = splitLeadingLatin(text);
  return { main, note, text };
}

/** 首个中文字（含中日韩标点）出现处切一刀：前面是英文主句，后面是中文说明 */
function splitLeadingLatin(text: string): { main: string; note: string } {
  const t = (text || '').trim();
  const idx = t.search(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/);
  if (idx <= 0) return { main: t, note: '' };
  const main = t.slice(0, idx).trim();
  // 句首不是英文（例如先给中文再给英文）→ 整段进主文，不做切分
  if (!/[A-Za-z]{2,}/.test(main)) return { main: t, note: '' };
  return { main, note: t.slice(idx).trim() };
}

/** 目标语言关键词 → 展示名（顺序影响匹配优先级，只认常见语种） */
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

/**
 * 从用户提问里推断翻译方向（如「中文 → 英语」）。
 * 推断不出返回空串 —— 调用方据此不渲染 meta（不猜、不留空白）。
 */
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
  // 最后提到的语种是中文 → 说明目标语是中文，源语取前一个（没有则默认英语）
  if (last.key === '中文') {
    const src = hits.length > 1 ? hits[hits.length - 2].key : '英语';
    return `${src} → 中文`;
  }
  return `中文 → ${last.key}`;
}

/**
 * AI 回答 blocks 解析：把 agent/run 返回的纯文本流解析为结构化块（原型 d43117b 的 blocks 表达落码）。
 *
 * 设计约束（specs/portal-redesign/page-spec.md §2.1 / §2.2）：
 * - **轻量解析，不引 markdown 库**：按空行分段、`1. ` 序号行、法条句式三类规则切分；
 * - **解析不出任何结构 → 降级为纯段落**（不报错、不吞内容）；
 * - 翻译 agent（agentId=translate 或文本含【推荐译文】四段契约）→ 翻译卡片，
 *   解析规则与小程序 `utils/translate-parse.ts` 的 `parseSections` 对齐（不猜、不拆词）。
 */
export type AnswerBlock =
  | { t: 'p'; v: string; lead?: boolean }
  | { t: 'h'; v: string }
  | { t: 'ol'; items: string[] }
  | { t: 'ul'; items: string[] }
  | { t: 'law'; src: string; v: string }
  | { t: 'tcard'; dir: string; main: string; note: string };

/** 内联加粗分段：把 `**text**` 拆成 txt/b 段（渲染层插值，不用 v-html，无 XSS 面） */
export interface BoldSeg {
  b: boolean;
  v: string;
}

export function boldSegs(v: string): BoldSeg[] {
  const parts = (v || '').split(/\*\*(.+?)\*\*/g);
  return parts
    .filter((s) => s !== '')
    .map((s, i) => {
      const isBold = i % 2 === 1;
      // 未配对的残余 ** 直接剥掉
      return { b: isBold, v: isBold ? s : s.replace(/\*\*/g, '') };
    })
    .filter((s) => s.v !== '');
}

/** 剥 markdown 行内标记（列表项 / 法条等不渲染加粗时用） */
export function stripInline(v: string): string {
  return (v || '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*\*/g, '');
}

const TRANSLATE_SECTION_TITLES = ['推荐译文', '直译对照', '委婉版', '语气要点'] as const;

export interface ParseOptions {
  /** 意图路由结果（intent.agentId），translate 时优先走翻译卡片 */
  agentId?: string;
  /** 该轮用户提问（推断翻译方向文案用） */
  question?: string;
}

export function parseAnswer(raw: string, opts: ParseOptions = {}): AnswerBlock[] {
  const text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  // 翻译四段契约：【推荐译文】…【直译对照】…【委婉版】…【语气要点】…
  if (opts.agentId === 'translate' || text.includes('【推荐译文】')) {
    const card = parseTranslateCard(text, opts.agentId, opts.question);
    if (card) return [card];
  }

  const paras = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  const blocks: AnswerBlock[] = [];
  paras.forEach((para, idx) => {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);

    // markdown 小标题：### xxx
    const mdHeading = para.match(/^#{1,4}\s+(.+)$/);
    if (mdHeading && lines.length === 1) {
      blocks.push({ t: 'h', v: mdHeading[1].trim() });
      return;
    }

    // 有序列表：过半行以「1. / 1、/ 1)」开头
    const olLines = lines.filter((l) => /^\d{1,2}[.、)]\s*\S/.test(l));
    if (lines.length >= 2 && olLines.length >= Math.ceil(lines.length / 2)) {
      blocks.push({ t: 'ol', items: lines.map((l) => l.replace(/^\d{1,2}[.、)]\s*/, '')) });
      return;
    }

    // 无序列表：过半行以「- / * / • 」开头
    const ulLines = lines.filter((l) => /^[-*•]\s+\S/.test(l));
    if (lines.length >= 2 && ulLines.length >= Math.ceil(lines.length / 2)) {
      blocks.push({ t: 'ul', items: lines.map((l) => l.replace(/^[-*•]\s+/, '')) });
      return;
    }

    // 法条引用：《…》第…条：正文
    const lawMatch = para.match(/^(《[^》]{1,20}》\s*第[一二三四五六七八九十百千\d]+条[^：:]*)[：:]\s*([\s\S]+)$/);
    if (lawMatch) {
      blocks.push({ t: 'law', src: lawMatch[1].trim(), v: lawMatch[2].trim() });
      return;
    }

    // 小标题：非首段、短、不以标点收尾
    if (idx > 0 && para.length <= 20 && !/[。.？！？：:]$/.test(para)) {
      blocks.push({ t: 'h', v: para });
      return;
    }

    // 段落；首段短句作结论先行（lead）
    const lead = idx === 0 && para.length <= 60 && /[。]$/.test(para);
    blocks.push({ t: 'p', v: para, lead });
  });

  // 降级兜底：什么都没解析出来（理论不可达，split 至少一段）→ 单纯段落
  if (!blocks.length) blocks.push({ t: 'p', v: text });
  return blocks;
}

/**
 * 翻译卡片解析：
 * - 优先命中四段契约（对齐小程序 parseSections，由 agent 提示词保证）；
 * - 未命中四段时（后端未按契约输出/纯译文一句），对齐小程序 `splitLeadingLatin` 兜底：
 *   回复以拉丁字母开头时，在首个 CJK 字符/中文标点处切一刀——前段为译文主文、后段为注解；
 *   首字符非拉丁字母则整段进主文（不猜、不留白）。
 */
function parseTranslateCard(text: string, agentId?: string, question?: string): AnswerBlock | null {
  const secs: Partial<Record<(typeof TRANSLATE_SECTION_TITLES)[number], string>> = {};
  TRANSLATE_SECTION_TITLES.forEach((title, i) => {
    const marker = `【${title}】`;
    const at = text.indexOf(marker);
    if (at === -1) return;
    const start = at + marker.length;
    let end = text.length;
    for (let j = i + 1; j < TRANSLATE_SECTION_TITLES.length; j++) {
      const next = text.indexOf(`【${TRANSLATE_SECTION_TITLES[j]}】`, start);
      if (next > -1) {
        end = next;
        break;
      }
    }
    secs[title] = text.slice(start, end).trim();
  });

  const main = secs['推荐译文'];
  if (main) {
    const note = (['直译对照', '委婉版', '语气要点'] as const)
      .filter((k) => secs[k])
      .map((k) => `${k}：${secs[k]}`)
      .join('\n');
    return { t: 'tcard', dir: inferDirection(question), main, note };
  }

  // 兜底：仅当意图确为 translate（历史消息也可能带【推荐译文】被上面命中）
  if (agentId !== 'translate') return null;
  return splitLeadingLatin(text, question);
}

/** 对齐小程序 splitLeadingLatin：首个 CJK 字符/中文标点前为拉丁主文 */
function splitLeadingLatin(text: string, question?: string): AnswerBlock {
  const firstCjk = text.search(/[\u4e00-\u9fff\u3001-\u303f\uff00-\uffef，。；：！？、…]/);
  const startsLatin = /^[A-Za-z]/.test(text.trim());
  if (!startsLatin || firstCjk <= 0) {
    return { t: 'tcard', dir: inferDirection(question), main: text.trim(), note: '' };
  }
  return {
    t: 'tcard',
    dir: inferDirection(question),
    main: text.slice(0, firstCjk).trim(),
    note: text.slice(firstCjk).trim(),
  };
}

/** 从提问推断方向文案（对齐小程序 inferTranslateDirection 的规则口径，推断不出给通用文案） */
function inferDirection(question?: string): string {
  if (!question) return '翻译结果';
  if (/(翻译|译)成.{0,6}英(语|文)/.test(question) || /英(语|文)怎么(说|讲)/.test(question)) return '中文 → 英语';
  if (/(翻译|译)成.{0,6}日(语|文|本)/.test(question)) return '中文 → 日语';
  if (/(翻译|译)成.{0,6}德(语|文)/.test(question)) return '中文 → 德语';
  if (/(翻译|译)成.{0,6}中(文|语)/.test(question)) return '英语 → 中文';
  return '翻译结果';
}

/**
 * 折叠截断（Q9 拍板）：按块边界取前若干块（累计约 90 字止），
 * 绝不把法条 / 列表块切一半；行数 clamp 会在元素中间截断，已被否决。
 */
export function foldCut(blocks: AnswerBlock[]): AnswerBlock[] {
  let n = 0;
  const out: AnswerBlock[] = [];
  for (const b of blocks) {
    out.push(b);
    if (b.t === 'p' || b.t === 'ol' || b.t === 'ul' || b.t === 'law') {
      n += b.t === 'p' || b.t === 'law' ? b.v.length : b.items.join('').length;
    }
    if (n >= 90) break;
  }
  return out;
}

/**
 * 历史回放补判（对齐小程序 looksLikeTranslateReply）：
 * 历史消息没有 intent 事件，按文本特征补判翻译回复——
 * 含【推荐译文】四段契约，或「以英文字母开头且后面出现中文」（切拉丁兜底的典型形态）。
 */
export function looksLikeTranslateReply(text: string): boolean {
  if (!text) return false;
  if (text.includes('【推荐译文】')) return true;
  const t = text.trim();
  return /^[A-Za-z]/.test(t) && /[\u4e00-\u9fff]/.test(t);
}

/** 纯文本字数（折叠阈值判定用；不含 tcard） */
export function plainLength(blocks: AnswerBlock[]): number {
  return blocks
    .filter((b): b is Extract<AnswerBlock, { t: 'p' }> => b.t === 'p')
    .map((b) => b.v)
    .join('')
    .length;
}
/**
 * 翻译四段契约解析（翻译工作台用）：把 agent 输出按
 * 【推荐译文】/【直译对照】/【委婉版】/【语气要点】切分为独立字段。
 * 一个标题都没命中时返回空对象（对齐小程序 utils/translate-parse.ts parseSections）。
 */
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

/** 流式过程中还没凑齐段落时，去掉【标题】直接展示已收到的正文（对齐小程序 stripTitles） */
export function stripTitles(text: string): string {
  return (text || '').replace(/【[^】]*】/g, '').trim();
}

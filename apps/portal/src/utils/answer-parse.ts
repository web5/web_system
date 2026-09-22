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
}

export function parseAnswer(raw: string, opts: ParseOptions = {}): AnswerBlock[] {
  const text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  // 翻译四段契约：【推荐译文】…【直译对照】…【委婉版】…【语气要点】…
  if (opts.agentId === 'translate' || text.includes('【推荐译文】')) {
    const card = parseTranslateCard(text);
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
 * 翻译四段解析（对齐小程序 parseSections，但不做「首英文段」猜测——
 * 契约由 agent 提示词保证，命中不了就返回 null 走普通段落，不猜不留白）。
 */
function parseTranslateCard(text: string): AnswerBlock | null {
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
  if (!main) return null;
  const note = (['直译对照', '委婉版', '语气要点'] as const)
    .filter((k) => secs[k])
    .map((k) => `${k}：${secs[k]}`)
    .join('\n');
  return { t: 'tcard', dir: '翻译结果', main, note };
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

/** 纯文本字数（折叠阈值判定用；不含 tcard） */
export function plainLength(blocks: AnswerBlock[]): number {
  return blocks
    .filter((b): b is Extract<AnswerBlock, { t: 'p' }> => b.t === 'p')
    .map((b) => b.v)
    .join('')
    .length;
}

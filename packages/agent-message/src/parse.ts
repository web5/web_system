import type { AnswerBlock, ParseOptions } from './types';
import { TRANSLATE_SECTION_TITLES, inferDirection } from './translate';

/**
 * AI 回答 blocks 解析：把 agent/run 返回的纯文本流解析为结构化块。
 *
 * 设计约束：
 * - 轻量解析，不引 markdown 库：空行分段 + `1. ` 序号行 + 法条句式 + ``` 围栏四类规则；
 * - 解析不出任何结构 → 降级为纯段落（不报错、不吞内容）；
 * - 翻译 agent（agentId=translate 或文本含【推荐译文】四段契约）→ 翻译卡片。
 */
export function parseAnswer(raw: string, opts: ParseOptions = {}): AnswerBlock[] {
  const text = (raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  // 翻译四段契约：【推荐译文】…【直译对照】…【委婉版】…【语气要点】…
  if (opts.agentId === 'translate' || text.includes('【推荐译文】')) {
    const card = parseTranslateCard(text, opts.agentId, opts.question);
    if (card) return [card];
  }

  // markdown ``` 围栏优先提取：围栏代码块整块保留（不按空行切、不判列表/法条），
  // 非围栏段走轻量段落解析；未闭合围栏（流式截断态）留在尾部普通文本里 → 降级纯段落，不吞内容。
  const blocks: AnswerBlock[] = [];
  for (const seg of splitFences(text)) {
    if (typeof seg !== 'string') {
      blocks.push(seg);
    } else {
      blocks.push(...parsePlain(seg));
    }
  }

  // 降级兜底：什么都没解析出来（理论不可达，split 至少一段）→ 单纯段落
  if (!blocks.length) blocks.push({ t: 'p', v: text });
  return blocks;
}

/** 把文本切成「普通文本段 | code 块」序列，保持原顺序；未闭合围栏留作普通文本 */
function splitFences(text: string): Array<string | { t: 'code'; lang: string; v: string }> {
  const re = /```([^\n`]*)[ \t]*\n([\s\S]*?)\n```/g;
  const out: Array<string | { t: 'code'; lang: string; v: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ t: 'code', lang: (m[1] || '').trim() || 'code', v: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 普通文本段解析：空行分段 + 标题/有序/无序/法条/小标题/段落判定 */
function parsePlain(text: string): AnswerBlock[] {
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

  return blocks;
}

/**
 * 翻译卡片解析：
 * - 优先命中四段契约（对齐 parseSections，由 agent 提示词保证）；
 * - 未命中四段时（后端未按契约输出/纯译文一句），对齐 splitLeadingLatin 兜底：
 *   回复以拉丁字母开头时，在首个 CJK 字符/中文标点处切一刀——前段为译文主文、后段为注解。
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

/** 首个 CJK 字符/中文标点前为拉丁主文 */
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

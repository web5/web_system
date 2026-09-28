/**
 * 意图分类器 —— 决定「这一句该交给哪个 agent」。
 *
 * 设计要点（详见 apps/kedou-ai-minigram/docs/意图识别-实现方案.md）：
 *  - 纯 TS：不依赖 DB / Nest，可单测；
 *  - 三级快通道：显式 > 会话锁定 > 规则 > LLM > 兜底，绝大多数轮次零延迟零成本；
 *  - 分类必然有误判，所以**兜底必须存在**：没把握时宁可给 general，也不把用户扔进错误的专家。
 *
 * ⚠️ 两个硬性约束：
 *  1. 注入的 client 必须是 **flash 档小模型**（分类是 N 选 1 的简单活，用主对话同档模型会让
 *     每次对话 token 成本翻倍，收益几乎为零）；
 *  2. `candidates` 必须来自 `AgentRegistry.list()` **实时取**，不能写死，
 *     否则后台增删 agent 后路由表与注册表对不上。
 *
 * ⚠️ 路由线索来源（2026-09-28 修）：
 *  规则关键词 + LLM 候选描述**必须由注册表实时提供**（`routingHints`），不能写死本文件。
 *  历史教训：早期把一套 taxonomy（translate/horoscope/tool/baike/emotion）硬编码在这里，
 *  线上注册表换成 bianbian/contract-risk/deploy/study-assistant/web-system-dev 后，
 *  规则永不命中、LLM 结果被候选白名单丢弃 ⇒ 100% 兜底，等于路由失效。
 *  未传 routingHints 时才退回 LEGACY_RULE_TABLE（仅供旧单测 / 降级兼容，不要在新代码依赖）。
 */
import type { BaseAiClient } from '../clients/base-ai.client';

export type IntentVia = 'explicit' | 'locked' | 'rule' | 'llm' | 'fallback';

export interface IntentResult {
  agentId: string;
  /** 0~1 */
  confidence: number;
  via: IntentVia;
}

/** 单个 agent 的路由线索（来自 agent 定义：后台可编辑，改完随轮询生效） */
export interface IntentRoutingHint {
  id: string;
  name: string;
  /** 一句话用途说明：喂给 LLM 分类器（比只给 id 准得多） */
  description?: string | null;
  /** 关键词：命中即规则路由，零 LLM 开销 */
  keywords?: string[] | null;
}

export interface ClassifyOptions {
  /** 白名单：来自 AgentRegistry.list() —— 不在表内的 agentId 一律丢弃（防模型幻觉） */
  candidates: string[];
  /**
   * 路由线索（推荐）：由 IntentService 从注册表实时生成。
   * 不传则退回 LEGACY_RULE_TABLE（旧 taxonomy，仅兼容用）。
   */
  routingHints?: IntentRoutingHint[];
  /** 会话已锁定的 agent（有则不重分类） */
  lockedAgentId?: string;
  timeoutMs?: number;
}

interface Rule {
  agentId: string;
  kw: RegExp;
  confidence: number;
}

/** 关键词命中的置信度（≥0.88 ⇒ 允许从已锁定 agent 切走，与 IntentService 判定阈值对齐） */
const KEYWORD_RULE_CONFIDENCE = 0.9;

/**
 * 旧 taxonomy 规则表（**仅兼容**：caller 未传 routingHints 时使用）。
 * ⚠️ 不要在这里加新的 agent —— 新增/调整路由请改后台 agent 定义的「路由关键词」。
 */
const LEGACY_RULE_TABLE: Array<{ agentId: string; kw: RegExp; confidence: number }> = [
  { agentId: 'translate', kw: /(翻译|翻成|译成|(英|日|韩|法|德|俄|西)语?怎么(说|讲)|英文怎么讲)/, confidence: 0.92 },
  { agentId: 'horoscope', kw: /(星座|运势|星盘|塔罗|八字|生肖|上升星座|水逆)/, confidence: 0.93 },
  { agentId: 'tool', kw: /(查一下|帮我算|汇率|天气|快递|股价|今天几号|单位换算)/, confidence: 0.88 },
  { agentId: 'baike', kw: /(是什么|为什么|原理|如何工作|介绍一下|区别是|科普)/, confidence: 0.8 },
  { agentId: 'emotion', kw: /(好累|难受|emo|焦虑|睡不着|想聊聊|心情不好|压力大)/i, confidence: 0.85 },
];

/** 把关键词数组编成一个「或」正则（转义正则元字符；中文无需词边界） */
function keywordsToRegExp(keywords: string[]): RegExp | null {
  const cleaned = keywords
    .map((k) => String(k || '').trim())
    .filter(Boolean)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!cleaned.length) return null;
  // 长词优先，避免「画」抢掉「画画」这类包含关系的歧义（同等长度按字典序稳定）
  cleaned.sort((a, b) => b.length - a.length || a.localeCompare(b));
  return new RegExp(cleaned.join('|'));
}

/** 由路由线索生成规则（只保留在候选集内的 agent） */
function rulesFromHints(hints: IntentRoutingHint[], candidates: string[]): Rule[] {
  const rules: Rule[] = [];
  for (const h of hints) {
    if (!h?.id || !Array.isArray(h.keywords) || h.keywords.length === 0) continue;
    const kw = keywordsToRegExp(h.keywords);
    if (!kw) continue;
    rules.push({ agentId: h.id, kw, confidence: KEYWORD_RULE_CONFIDENCE });
  }
  // 确定性顺序：按 agentId 稳定排序（注册表遍历顺序可能因 DB 返回顺序变化）
  return rules
    .filter((r) => candidates.includes(r.agentId))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

/** LLM 候选清单：有线索时带上 name + description，纯 id 会让小模型瞎猜 */
function buildCandidateSection(hints: IntentRoutingHint[], candidates: string[]): string {
  const picked = hints.filter((h) => h && candidates.includes(h.id));
  if (!picked.length) return '';
  return picked
    .map((h) => {
      const desc = (h.description || '').trim();
      return `- ${h.id}${h.name ? `（${h.name}）` : ''}${desc ? `：${desc}` : ''}`;
    })
    .join('\n');
}

const CLASSIFY_PROMPT = `你是意图分类器。只输出一行 JSON，不要任何解释、不要 markdown 围栏。

可选 agent：
- emotion   情感陪聊、情绪倾诉、安慰共情
- baike     百科科普、知识问答、原理讲解
- horoscope 星座、运势、性格、塔罗（命理类，需免责）
- translate 语言翻译、润色、多语种互译
- tool      工具服务：查汇率/天气/快递/计算/实时信息
- general   以上都不是，或输入过短无法判断

输出格式：{"agentId":"xxx","confidence":0.9,"reason":"10字内"}
confidence 低于 0.6 时直接选 general。`;

/** 线索驱动的分类提示词：候选清单由注册表实时拼出 */
function buildPrompt(candidateSection: string, fallbackAgentId: string): string {
  return [
    '你是意图分类器。只输出一行 JSON，不要任何解释、不要 markdown 围栏。',
    '',
    '可选 agent（**只能从下面这些里选**）：',
    candidateSection,
    '',
    `- ${fallbackAgentId}：以上都不是，或输入过短 / 无法判断时选它`,
    '',
    '输出格式：{"agentId":"xxx","confidence":0.9,"reason":"10字内"}',
    `判断没把握（confidence < 0.6）时直接选 ${fallbackAgentId}。`,
  ].join('\n');
}

export class IntentClassifier {
  constructor(
    private readonly client: BaseAiClient,
    private readonly timeoutMs = 1200,
    /** 兜底 agent：超时 / 解析失败 / 未知 agentId 时用（P0 安全阀，必须存在） */
    private readonly fallbackAgentId = 'general',
  ) {}

  async classify(userInput: string, o: ClassifyOptions): Promise<IntentResult> {
    const candidates = o.candidates ?? [];
    const hints = Array.isArray(o.routingHints) ? o.routingHints : [];
    const rules = hints.length ? rulesFromHints(hints, candidates) : LEGACY_RULE_TABLE;

    // L1-a 显式指定：`@星座 …` 最高优先级，无条件服从
    const at = userInput.match(/^@([a-z0-9-]+)[\s:：]*/i);
    if (at && candidates.includes(at[1])) {
      return { agentId: at[1], confidence: 1, via: 'explicit' };
    }

    // L1-b 会话锁定：先查规则表 —— 高置信规则命中**其他** agent 时允许切走
    //（如锁定的情感陪聊里突然问「英语怎么说」）；未命中则沿用锁定（零成本、不调 LLM）。
    // ⚠️ 不能在这里直接短路返回 locked：那样话题切换永远失效，
    //    与实现方案 §9「已锁定 baike 时说『帮我翻一下』应切到 translate」的用例矛盾。
    if (o.lockedAgentId && candidates.includes(o.lockedAgentId)) {
      for (const r of rules) {
        if (r.agentId !== o.lockedAgentId && r.kw.test(userInput) && candidates.includes(r.agentId)) {
          return { agentId: r.agentId, confidence: r.confidence, via: 'rule' };
        }
      }
      return { agentId: o.lockedAgentId, confidence: 1, via: 'locked' };
    }

    // L2 规则
    for (const r of rules) {
      if (r.kw.test(userInput) && candidates.includes(r.agentId)) {
        return { agentId: r.agentId, confidence: r.confidence, via: 'rule' };
      }
    }

    // L3 LLM（超时 / 失败 → L4，绝不阻塞主对话）
    try {
      const section = buildCandidateSection(hints, candidates);
      const prompt = section
        ? buildPrompt(section, this.fallbackAgentId)
        : CLASSIFY_PROMPT;
      const raw = await this.withTimeout(
        this.client.chat(
          [
            { role: 'system', content: prompt, ts: Date.now() },
            { role: 'user', content: userInput.slice(0, 500), ts: Date.now() },
          ],
          { temperature: 0, maxTokens: 60 },
        ),
        o.timeoutMs ?? this.timeoutMs,
      );
      const parsed = this.parse(raw, candidates);
      if (parsed) return parsed;
    } catch {
      /* 落到 L4 */
    }
    // L4 兜底
    return { agentId: this.fallbackAgentId, confidence: 0.3, via: 'fallback' };
  }

  /** 解析容错三道防线：去围栏 → 正则抠 JSON → 校验 agentId 在白名单内 */
  private parse(raw: string, candidates: string[]): IntentResult | null {
    if (!raw) return null;
    const cleaned = raw.replace(/```(?:json)?/g, '').trim();
    const m = cleaned.match(/\{[\s\S]*?\}/);
    if (!m) return null;
    try {
      const j = JSON.parse(m[0]) as { agentId?: unknown; confidence?: unknown };
      const id = String(j.agentId ?? '').trim();
      if (!candidates.includes(id)) return null; // 幻觉 agentId → 丢弃
      const c = Number(j.confidence);
      return {
        agentId: id,
        confidence: Number.isFinite(c) ? Math.min(Math.max(c, 0), 1) : 0.6,
        via: 'llm',
      };
    } catch {
      return null;
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('classify timeout')), ms)),
    ]);
  }
}

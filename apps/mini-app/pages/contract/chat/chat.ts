/**
 * 合同翻译官 - 对话追问页
 * 独立对话界面，两种进入方式：
 *  1. 从结果页点击"追问：xxx"进入：第一轮=分析结论(AI)，第二轮=追问问题(user)，自动触发 AI 分析回复
 *  2. 从结果页点击"追问"按钮进入：只有第一轮=分析结论(AI)，空白等待用户自行提问
 *  3. 从历史记录进入（带 conversationId）：渲染该对话全部历史轮次（报告结论 + 既往追问），可继续追问
 * 追问复用同一会话（conversationId），AI 结合已分析的合同上下文作答。
 */
import type { ContractReport } from '../../../services/contract-api';
import { sendContractFollowUp, sendContractFollowUpStream, getContractConversation } from '../../../services/contract-api';

interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
  /** 内部唯一 id，用于流式阶段定位气泡（仅运行时使用，不渲染） */
  _id?: string;
  /** 是否正在接收 SSE 增量（true 时显示流式光标） */
  streaming?: boolean;
}

/** 工具名 → 中文执行文案（与 analyzing / assistant 屏同义，工具阶段可见输出） */
const TOOL_HINT: Record<string, string> = {
  'contract-cleaner': '正在清洗 OCR 识别噪声…',
  'contract-rule': '正在扫描法定风险信号…',
  'contract-irr': '正在测算真实年化利率…',
  'contract-benchmark': '正在对比市场基准…',
  'law-search': '正在检索法律条文…',
  'web-search': '正在联网检索…',
};

/** 快捷追问 chips：收集报告里 signals/rights/optimize 的可追问问题，去空去重 */
function collectSuggestions(report?: ContractReport | null): string[] {
  if (!report) return [];
  const out: string[] = [];
  const push = (qs: unknown) => {
    if (!Array.isArray(qs)) return;
    for (const q of qs) {
      const s = String(q ?? '').trim();
      if (s && !out.includes(s)) out.push(s);
    }
  };
  for (const s of report.signals || []) push(s.askableQuestions);
  for (const r of report.rights || []) push(r.askableQuestions);
  for (const o of report.optimize || []) push(o.askableQuestions);
  return out.slice(0, 6);
}

/** assistant 消息展示文本：历史消息中的报告 JSON 太长，折叠为结论；普通文本直出 */
function displayAssistantText(content: string, report?: ContractReport | null): string {
  const t = (content || '').trim();
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t) as unknown;
      if (obj && typeof obj === 'object') {
        const rec = obj as Record<string, unknown>;
        if (Array.isArray(rec.signals) || typeof rec.scene === 'string') {
          return report?.conclusion || '（风险报告，详见结果页）';
        }
      }
    } catch {
      // 非 JSON 按普通文本展示
    }
  }
  return content || '';
}

Page({
  data: {
    conversationId: '',
    chatMessages: [] as ChatMsg[],
    input: '',
    sending: false,
    /** 历史对话加载中（加载完成前禁止发送，避免并发覆盖初始消息） */
    historyLoading: false,
    /** 快捷追问 chips（来自当前报告的 askableQuestions） */
    suggestions: [] as string[],
    /** chips 是否可见：聚焦输入时浮现，失焦/发送后收起 */
    showChips: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    const question = options?.question ? decodeURIComponent(options.question).trim() : '';
    const cid = options?.conversationId;

    // 方式一：带 conversationId（历史打开 / result 携带会话进入）→ 从接口加载历史消息
    if (cid) {
      this.initConversation(cid, question);
      return;
    }

    // 方式二：即时分析链（result 无参跳转）→ 从本地 storage 恢复最近报告
    const storage = wx.getStorageSync('contract_report');
    const report = storage.latest as ContractReport | undefined;
    if (!report) {
      wx.showToast({ title: '暂无报告数据', icon: 'none' });
      this.setData({
        chatMessages: [{ role: 'ai', text: '未获取到合同分析结果，请先完成一次合同分析。' }],
      });
      return;
    }

    // 第一轮：分析结论作为 AI 首条消息
    const aiMsg = report.conclusion
      ? report.conclusion
      : '合同风险分析已完成。有什么具体条款想进一步了解，可以直接问我。';
    const chatMessages: ChatMsg[] = [{ role: 'ai', text: aiMsg }];
    this.setData({
      conversationId: report.conversationId || '',
      chatMessages,
      suggestions: collectSuggestions(report),
    });

    // 从结果页"追问：xxx"带入的问题 → 作为第二轮用户消息，并自动触发 AI 分析回复
    if (question) {
      this.sendWith(question);
    }
  },

  /** 从对话详情恢复历史轮次（报告轮 → conclusion，后续轮次原样），随后可选自动追问 */
  async initConversation(conversationId: string, question: string) {
    this.setData({ conversationId, historyLoading: true });
    try {
      const detail = await getContractConversation(conversationId);
      const chatMessages: ChatMsg[] = [];
      for (const m of detail.messages) {
        if (m.role === 'user') {
          chatMessages.push({ role: 'user', text: m.content });
        } else if (m.role === 'assistant') {
          const text = displayAssistantText(m.content, detail.report);
          if (text) chatMessages.push({ role: 'ai', text });
        }
        // tool 消息不展示
      }
      this.setData({
        chatMessages,
        suggestions: collectSuggestions(detail.report),
      });
    } catch (err: any) {
      // 把错误细节打到 console，便于排查（401/404/500/网络）
      console.error('[chat] history load failed', { conversationId, err });
      // 降级：网络/服务异常时，回退到本地缓存的报告（同一会话的首条结论），
      // 让用户能继续追问；如彻底拿不到也给出更明确提示而不是冷冰冰的"加载失败"
      const storage = wx.getStorageSync('contract_report');
      const last = storage?.latest as (ContractReport & { conversationId?: string }) | undefined;
      const errHint =
        (err && (err.statusCode ? `HTTP ${err.statusCode}` : null)) ||
        (err && (err.errMsg || err.message)) ||
        '网络异常';
      if (last && last.conversationId === conversationId) {
        const aiMsg = last.conclusion || '合同风险分析已完成。有什么具体条款想进一步了解，可以直接问我。';
        this.setData({
          chatMessages: [{ role: 'ai', text: aiMsg }],
          suggestions: collectSuggestions(last),
        });
        wx.showToast({
          title: `对话历史暂未拉到（${errHint}），已显示最近一次报告`,
          icon: 'none',
          duration: 2500,
        });
      } else {
        this.setData({
          chatMessages: [
            { role: 'ai', text: `对话历史暂时拉不到（${errHint}）。你仍然可以继续追问——AI 会结合该会话上下文回复。` },
          ],
        });
      }
    } finally {
      this.setData({ historyLoading: false });
    }

    if (question) {
      this.sendWith(question);
    }
  },

  onInput(e: any) {
    this.setData({ input: e.detail.value });
  },

  /** 聚焦输入框：浮现快捷追问 chips（有建议时） */
  onInputFocus() {
    if (this.data.suggestions.length) {
      this.setData({ showChips: true });
    }
  },

  /** 失焦：延迟收起 chips，避免点 chip 时被误收 */
  onInputBlur() {
    (this as any).chipsHideTimer = setTimeout(() => {
      this.setData({ showChips: false });
    }, 250);
  },

  /** 收起 chips 并清掉延迟计时器 */
  clearChips() {
    if ((this as any).chipsHideTimer) {
      clearTimeout((this as any).chipsHideTimer);
      (this as any).chipsHideTimer = null;
    }
    this.setData({ showChips: false });
  },

  /** 点击快捷追问 chip：直接以该问题发起追问 */
  onTapChip(e: any) {
    if (this.data.historyLoading) {
      wx.showToast({ title: '对话加载中，请稍候', icon: 'none' });
      return;
    }
    const question = String(e.currentTarget.dataset.q || '').trim();
    if (!question) return;
    this.sendWith(question);
  },

  /** 发送追问 */
  send() {
    if (this.data.historyLoading) {
      wx.showToast({ title: '对话加载中，请稍候', icon: 'none' });
      return;
    }
    const question = this.data.input.trim();
    if (!question) {
      wx.showToast({ title: '先输入你的问题', icon: 'none' });
      return;
    }
    this.sendWith(question);
  },

  /** 发送追问（内部实现，支持传入具体问题）—— 真 SSE 流式渲染 */
  sendWith(question: string) {
    if (this.data.sending) return;
    this.clearChips(); // 发送即收起快捷问题条
    const conversationId = this.data.conversationId;

    if (!conversationId) {
      wx.showToast({ title: '暂不支持追问', icon: 'none' });
      return;
    }

    // 先 push 用户消息 + 一条 AI 占位气泡（流式期间持续更新 text）
    const aiId = `ai-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    (this as any)._aiIds = (this as any)._aiIds || new Set();
    (this as any)._aiIds.add(aiId);
    const baseMessages = [
      ...this.data.chatMessages,
      { role: 'user' as const, text: question, _id: `u-${Date.now()}` },
      { role: 'ai' as const, text: '', _id: aiId, streaming: true },
    ];
    this.setData({ chatMessages: baseMessages, input: '', sending: true });
    this.scrollToBottom();

    const replaceAiText = (nextText: string, done: boolean) => {
      const ids = (this as any)._aiIds as Set<string>;
      if (done) ids.delete(aiId);
      const messages = this.data.chatMessages.map((m: any) =>
        m._id === aiId ? { ...m, text: nextText, streaming: !done } : m,
      );
      this.setData({ chatMessages: messages });
      this.scrollToBottom();
    };

    sendContractFollowUpStream(question, conversationId, {
      onEvent: (event) => {
        // 工具阶段：把"思考中…"换成具体步骤文案，弥补流式报告前的"空档感"
        if (event.type === 'tool_call') {
          const name = event.name || '分析工具';
          replaceAiText(`🔧 ${TOOL_HINT[name] || `正在执行「${name}」…`}`, false);
        } else if (event.type === 'tool_result') {
          replaceAiText('✅ 已收到工具结果，正在整理回答…', false);
        } else if (event.type === 'start') {
          replaceAiText('正在思考你的问题…', false);
        }
      },
      onDelta: (delta) => {
        const cur = (this.data.chatMessages.find((m: any) => m._id === aiId) as any) || { text: '' };
        replaceAiText((cur.text || '') + delta, false);
      },
      onReply: (reply) => {
        replaceAiText(reply || '抱歉，暂时无法回答这个问题。', true);
        this.setData({ sending: false });
      },
      onError: (err) => {
        const cur = (this.data.chatMessages.find((m: any) => m._id === aiId) as any) || { text: '' };
        replaceAiText(`${cur.text || ''}\n\n追问失败：${err?.message || '稍后再试'}`.trim(), true);
        this.setData({ sending: false });
        wx.showToast({ title: '追问失败，请稍后再试', icon: 'none' });
      },
    });
  },

  scrollToBottom() {
    setTimeout(() => {
      try {
        wx.pageScrollTo({ scrollTop: 999999, duration: 200 });
      } catch {
        // 忽略
      }
    }, 100);
  },
});

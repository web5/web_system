/**
 * 合同翻译官 - 对话追问页
 * 独立对话界面，两种进入方式：
 *  1. 从结果页点击"追问：xxx"进入：第一轮=分析结论(AI)，第二轮=追问问题(user)，自动触发 AI 分析回复
 *  2. 从结果页点击"追问"按钮进入：只有第一轮=分析结论(AI)，空白等待用户自行提问
 *  3. 从历史记录进入（带 conversationId）：渲染该对话全部历史轮次（报告结论 + 既往追问），可继续追问
 * 追问复用同一会话（conversationId），AI 结合已分析的合同上下文作答。
 */
import type { ContractReport } from '../../../services/contract-api';
import { sendContractFollowUp, getContractConversation } from '../../../services/contract-api';

interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
}

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
      this.setData({ chatMessages, suggestions: collectSuggestions(detail.report) });
    } catch {
      this.setData({
        chatMessages: [{ role: 'ai', text: '对话历史加载失败，请稍后重试。' }],
      });
      return;
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

  /** 发送追问（内部实现，支持传入具体问题） */
  sendWith(question: string) {
    if (this.data.sending) return;
    const conversationId = this.data.conversationId;

    if (!conversationId) {
      wx.showToast({ title: '暂不支持追问', icon: 'none' });
      return;
    }

    this.setData({
      chatMessages: [...this.data.chatMessages, { role: 'user', text: question }],
      input: '',
      sending: true,
    });
    this.scrollToBottom();

    sendContractFollowUp(question, conversationId)
      .then((reply) => {
        this.setData({
          chatMessages: [
            ...this.data.chatMessages,
            { role: 'ai', text: reply || '抱歉，暂时无法回答这个问题。' },
          ],
          sending: false,
        });
        this.scrollToBottom();
      })
      .catch(() => {
        wx.showToast({ title: '追问失败，请稍后再试', icon: 'none' });
        this.setData({ sending: false });
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

/**
 * 合同翻译官 - 对话追问页
 * 独立对话界面，两种进入方式：
 *  1. 从结果页点击"追问：xxx"进入：第一轮=分析结论(AI)，第二轮=追问问题(user)，自动触发 AI 分析回复
 *  2. 从结果页点击"追问"按钮进入：只有第一轮=分析结论(AI)，空白等待用户自行提问
 * 追问复用初次分析的会话（conversationId），AI 结合已分析的合同上下文作答。
 */
import type { ContractReport } from '../../../services/contract-api';
import { sendContractFollowUp } from '../../../services/contract-api';

interface ChatMsg {
  role: 'user' | 'ai';
  text: string;
}

Page({
  data: {
    conversationId: '',
    chatMessages: [] as ChatMsg[],
    input: '',
    sending: false,
  },

  onLoad(options: Record<string, string | undefined>) {
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
    });

    // 从结果页"追问：xxx"带入的问题 → 作为第二轮用户消息，并自动触发 AI 分析回复
    const question = decodeURIComponent(options.question || '').trim();
    if (question) {
      this.sendWith(question);
    }
  },

  onInput(e: any) {
    this.setData({ input: e.detail.value });
  },

  /** 发送追问 */
  send() {
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

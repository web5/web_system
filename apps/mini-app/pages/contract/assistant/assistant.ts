/**
 * 合同助手 - 对话式体检入口
 *
 * 形态：发文字/图片 → 在对话流里看 AI 流式生成报告 → 报告卡（摘要 + 查看完整报告 + 继续追问）。
 *
 * 与"完成自动跳 result"的旧决策调整：留对话里看流式过程更符合"对话式体检"心智；
 * 用户想看完整报告时点 [查看完整报告] 按钮，携带 conversationId 跳 result 页。
 */
import { chooseAndRecognize } from '../../../services/ocr-api';
import {
  analyzeContractStream,
  sendContractFollowUpStream,
  type ContractReport,
  type StreamEvent,
} from '../../../services/contract-api';

type Msg =
  | { id: number; role: 'user'; kind: 'text' | 'image'; text: string; fullText: string }
  | { id: number; role: 'ai'; kind: 'report-text'; text: string; isStreaming: boolean; hint?: string }
  | { id: number; role: 'ai'; kind: 'report-card'; report: ContractReport; conversationId: string }
  | { id: number; role: 'ai'; kind: 'progress'; text: string; done: boolean }
  | { id: number; role: 'ai'; kind: 'text'; text: string };

/** 工具调用阶段 → 用户可见的进行中文案（与 analyzing 页 toolTextMap 同语义） */
const TOOL_HINTS: Record<string, string> = {
  'contract-cleaner': '正在清洗识别文本…',
  'contract-rule': '正在扫描法定风险信号…',
  'contract-irr': '正在测算真实年化利率…',
  'contract-benchmark': '正在对比市场基准…',
  'law-search': '正在检索法律条文…',
  'web-search': '正在联网检索…',
};

const AI_GREETING =
  '把要查的合同发给我：\n① 直接粘贴合同文字；\n② 或点左下角 ＋，拍照 / 从相册选合同照片。\n收到后我会立即在这对话里分析给你。';

/** 气泡预览：超过 N 字截断，避免用户长文本撑爆消息流 */
function previewUserText(text: string, max = 80): string {
  return text.length <= max ? text : `${text.slice(0, max)}…（共 ${text.length} 字）`;
}

/** 流动 ID 递增 */
let _mid = 0;
const nextId = (): number => ++_mid;

Page({
  data: {
    messages: [{ id: nextId(), role: 'ai', kind: 'text', text: AI_GREETING }] as Msg[],
    input: '',
    sending: false,
    conversationId: '',
    /** 用户原文抽屉：默认关闭，打开时展示完整文本 */
    userDrawer: { open: false, text: '' },
  },

  onLoad() {
    // 上一轮体检结束回到本页：给个收尾提示
    const last = wx.getStorageSync('contract_report')?.latest as
      | { scene?: string; conversationId?: string }
      | undefined;
    if (last?.scene) {
      this.setData({
        messages: [
          ...this.data.messages,
          { id: nextId(), role: 'ai', kind: 'text', text: `刚才那份「${last.scene}」已体检完成。想看详情在「历史」里点开；想查新合同，直接发我即可。` },
        ],
      });
    }
  },

  onInput(e: any) {
    this.setData({ input: e.detail.value });
  },

  /** 点 ＋：拍照 / 相册 → OCR → 识别文本进入对话流式分析 */
  onAttach() {
    if (this.data.sending) return;
    wx.showActionSheet({
      itemList: ['拍照识别', '从相册选择'],
      success: (res) => {
        const source: 'camera' | 'album' = res.tapIndex === 0 ? 'camera' : 'album';
        this.doOcr(source);
      },
      fail: () => {},
    });
  },

  doOcr(source: 'camera' | 'album') {
    chooseAndRecognize(source, {
      onUploadStart: () => this.setData({ sending: true }),
    })
      .then((res) => {
        this.setData({ sending: false });
        const text = (res.text || '').trim();
        if (!text) {
          wx.showToast({ title: '未识别到文字，试试直接粘贴文本', icon: 'none' });
          return;
        }
        this.pushUser(text, 'image', res.blockCount);
        this.startAnalyze(text);
      })
      .catch((err: any) => {
        this.setData({ sending: false });
        if (err?.errMsg && String(err.errMsg).includes('cancel')) return;
        wx.showModal({
          title: '识别失败',
          content: `${err?.message || 'OCR 识别失败'}。可改用粘贴合同文本。`,
          showCancel: false,
          confirmText: '知道了',
        });
      });
  },

  /** 直接发送文本（视为合同全文） */
  send() {
    if (this.data.sending) return;
    const text = this.data.input.trim();
    if (!text) {
      wx.showToast({ title: '先粘贴合同内容，或点 ＋ 选合同照片', icon: 'none' });
      return;
    }
    this.pushUser(text, 'text');
    this.setData({ input: '' });
    // 若已存在 conversationId（已分析过），这次按"追问"走（发往同会话 AI）
    if (this.data.conversationId) {
      this.startFollowUp(text);
    } else {
      this.startAnalyze(text);
    }
  },

  /** 用户气泡只展示摘要，不展示长合同原文（点击展开抽屉看完整内容） */
  pushUser(text: string, kind: 'text' | 'image', blockCount?: number) {
    const prefix = kind === 'image' ? `（图片识别 ${blockCount ?? 0} 段）\n` : '';
    this.setData({
      messages: [
        ...this.data.messages,
        { id: nextId(), role: 'user', kind, text: prefix + previewUserText(text), fullText: text },
      ],
    });
  },

  /** 打开用户原文抽屉 */
  onOpenUserText(e: any) {
    const id = Number(e.currentTarget.dataset.id);
    const msg = this.data.messages.find((m) => m.id === id);
    if (!msg || !('fullText' in msg)) return;
    this.setData({ userDrawer: { open: true, text: msg.fullText } });
  },

  /** 关闭用户原文抽屉 */
  onCloseUserText() {
    this.setData({ userDrawer: { open: false, text: '' } });
  },

  /** 首次分析：发 SSE 流式事件，在对话里逐字渲染 AI 报告文本；final 时 parseReport 渲染报告卡 */
  startAnalyze(text: string) {
    if (this.data.sending) return;
    this.setData({ sending: true });
    const aiId = nextId();
    // 报告流式主气泡：先空，等 onDelta 增量实时追加；移除此前的"打字机"模拟
    this.setData({
      messages: [
        ...this.data.messages,
        { id: aiId, role: 'ai', kind: 'report-text', text: '', isStreaming: true, hint: '已收到合同，开始体检…' },
      ],
    });
    let buffered = '';
    let conversationId = '';
    // 工具阶段进度气泡：同名工具复用同一气泡（避免重复刷屏）
    const toolBubbleMap = new Map<string, number>();
    const self = this;

    analyzeContractStream(text, '', {
      onEvent: (event: StreamEvent) => {
        // final 事件携带会话 id：供后续在同一对话追问复用（与 analyzing 页同法）
        if (event.type === 'final' && event.conversationId) {
          conversationId = event.conversationId;
          return;
        }
        // 工具执行阶段：每个工具一个独立小气泡（进行中），完成后打勾，
        // 让"分析"看起来在真正做，而不是一直在等一个长耗时后整体出结果
        if (event.type === 'tool_call') {
          const name = event.name || '分析';
          if (!toolBubbleMap.has(name)) {
            const pid = nextId();
            toolBubbleMap.set(name, pid);
            const tip = TOOL_HINTS[name] || `正在执行「${name}」…`;
            self.setData({ messages: self.appendProgress(pid, `🔧 ${tip}`, false) });
          }
        } else if (event.type === 'tool_result') {
          // 找到最近一个进行中的进度气泡，标完成；找不到就新建一条
          let pid: number | undefined;
          for (const [name, id] of toolBubbleMap.entries()) {
            const m = self.data.messages.find((x) => x.id === id);
            if (m && 'kind' in m && m.kind === 'progress' && !m.done) {
              pid = id;
              self.setData({ messages: self.markProgressDone(id, `✅ 「${name}」完成`) });
              break;
            }
          }
          if (pid === undefined) {
            const id = nextId();
            self.setData({ messages: self.appendProgress(id, '✅ 工具结果已收齐', true) });
          }
        } else if (event.type === 'start') {
          self.setData({ messages: self.updateHint(aiId, 'AI 正在开始分析…') });
        }
      },
      onDelta: (delta) => {
        // 真流式：后端吐字即追加，不做前端打字机模拟
        buffered += delta;
        self.setData({ messages: self.updateAiText(aiId, buffered) });
        self.scrollToBottom();
      },
      onDone: (report) => {
        // onDone 返回的已是容错解析好的结构化报告，直接用于报告卡渲染与缓存
        const safeReport: ContractReport = {
          scene: report?.scene || '未知',
          conclusion: report?.conclusion || '（报告已生成，但内容无法直接结构化展示，请点 [查看完整报告] 跳转查看）',
          signals: report?.signals || [],
          rights: report?.rights,
          loanPlan: report?.loanPlan,
          optimize: report?.optimize,
          keyNumbers: report?.keyNumbers,
          disclaimer: report?.disclaimer,
        };
        // 落本地缓存（与 result 页 / chat 追问页共用同一 storage key）
        try {
          wx.setStorageSync('contract_report', {
            latest: { ...safeReport, conversationId, createdAt: Date.now() },
          });
        } catch {}
        self.setData({
          conversationId,
          sending: false,
          messages: [
            ...self.removeById(aiId), // 移除流式正文气泡，替换为报告卡
            {
              id: nextId(),
              role: 'ai',
              kind: 'report-card',
              report: safeReport,
              conversationId,
            },
          ],
        });
        self.scrollToBottom();
      },
      onError: (e) => {
        self.setData({
          sending: false,
          messages: self.updateAiText(aiId, `${buffered}\n\n分析失败：${e.message}`).map((m) =>
            m.id === aiId ? { ...m, isStreaming: false } : m,
          ),
        });
      },
    });
  },

  /** 追问：已存在 conversationId 时调用（真 SSE 流式渲染，与 chat 屏同体验） */
  startFollowUp(question: string) {
    if (this.data.sending) return;
    if (!this.data.conversationId) return;
    this.setData({ sending: true });
    const aiId = nextId();
    // 工具阶段小气泡也用同一套 map
    const toolBubbleMap = new Map<string, number>();
    this.setData({
      messages: [
        ...this.data.messages,
        { id: aiId, role: 'ai', kind: 'text', text: '正在思考你的问题…' },
      ],
    });
    const self = this;
    const replaceText = (text: string) => {
      self.setData({ messages: self.replaceText(aiId, text) });
      self.scrollToBottom();
    };
    const appendProgress = (pid: number, text: string, done: boolean) => {
      self.setData({ messages: self.appendProgress(pid, text, done) });
      self.scrollToBottom();
    };
    sendContractFollowUpStream(question, this.data.conversationId, {
      onEvent: (event) => {
        if (event.type === 'tool_call') {
          const name = event.name || '分析';
          if (!toolBubbleMap.has(name)) {
            const pid = nextId();
            toolBubbleMap.set(name, pid);
            appendProgress(pid, `🔧 正在调用「${name}」…`, false);
          }
        } else if (event.type === 'tool_result') {
          for (const [name, pid] of toolBubbleMap.entries()) {
            const m = self.data.messages.find((x) => x.id === pid);
            if (m && 'kind' in m && m.kind === 'progress' && !m.done) {
              appendProgress(pid, `✅ 「${name}」完成`, true);
              break;
            }
          }
        } else if (event.type === 'start') {
          replaceText('正在思考你的问题…');
        }
      },
      onDelta: (delta) => {
        // 真实流式：每段 delta 立即追加到当前 AI 气泡
        const cur = (self.data.messages.find((m) => m.id === aiId) as any) || { text: '' };
        replaceText((cur.text || '') + delta);
      },
      onReply: (reply) => {
        self.setData({ sending: false });
        replaceText(reply || '抱歉，暂时无法回答这个问题。');
      },
      onError: (err) => {
        self.setData({ sending: false });
        const cur = (self.data.messages.find((m) => m.id === aiId) as any) || { text: '' };
        replaceText(`${cur.text || ''}\n\n追问失败：${err?.message || '稍后再试'}`.trim());
      },
    });
  },

  /** [查看完整报告]：跳 result 报告页（携带 conversationId 走 API 详情） */
  onOpenReport(e: any) {
    const id = Number(e.currentTarget.dataset.id);
    const msg = this.data.messages.find((m) => 'kind' in m && m.kind === 'report-card' && m.id === id) as
      | Extract<Msg, { kind: 'report-card' }>
      | undefined;
    if (!msg) return;
    wx.navigateTo({ url: `/pages/contract/result/result?conversationId=${msg.conversationId}` });
  },

  /** [继续追问]：聚焦到输入框（用户接着发文字 = 追问） */
  onContinueChat() {
    wx.showToast({ title: '在下方输入框继续发问', icon: 'none' });
  },

  /** 工具：构造"按 id 替换为新 text"的消息数组 */
  updateAiText(aiId: number, text: string): Msg[] {
    return this.data.messages.map((m) =>
      m.id === aiId && 'kind' in m && m.kind === 'report-text' ? { ...m, text, hint: '' } : m,
    ) as Msg[];
  },
  /** 工具：更新 AI 气泡的"进行中"文案（内容未出时展示） */
  updateHint(aiId: number, hint: string): Msg[] {
    return this.data.messages.map((m) =>
      m.id === aiId && 'kind' in m && m.kind === 'report-text' ? { ...m, hint } : m,
    ) as Msg[];
  },
  replaceText(aiId: number, text: string): Msg[] {
    return this.data.messages.map((m) => (m.id === aiId ? ({ ...m, text } as Msg) : m));
  },
  removeById(aiId: number): Msg[] {
    return this.data.messages.filter((m) => m.id !== aiId);
  },

  /** 工具：新增一个工具阶段"进度"小气泡（独立展示，不替换其他气泡） */
  appendProgress(pid: number, text: string, done: boolean): Msg[] {
    return [
      ...this.data.messages,
      { id: pid, role: 'ai' as const, kind: 'progress' as const, text, done },
    ];
  },
  /** 工具：把某条 progress 气泡标完成（替换其 text + done=true） */
  markProgressDone(pid: number, text: string): Msg[] {
    return this.data.messages.map((m) =>
      m.id === pid && 'kind' in m && m.kind === 'progress' ? { ...m, text, done: true } : m,
    );
  },

  scrollToBottom() {
    setTimeout(() => {
      try {
        wx.pageScrollTo({ scrollTop: 999999, duration: 200 });
      } catch {}
    }, 80);
  },
});

/**
 * 合同助手 - 对话式体检入口
 *
 * 按 v5 原型稿高保真实现：
 *  - 发合同后，AI 气泡 = 单张「步骤执行卡片」（清洗/扫描/测算/对比/生成报告 5 步）
 *    步骤逐项 灰(待执行) → 蓝(执行中) → 绿(完成)，不再碎成多条打字气泡
 *  - 全绿后追加「报告摘要卡」（查看完整报告 → result），并可在同会话继续追问
 *  - 追问（已存在 conversationId）走真 SSE 流式，逐字渲染回答
 */
import { chooseAndRecognize } from '../../../services/ocr-api';
import {
  analyzeContractStream,
  sendContractFollowUpStream,
  type ContractReport,
  type StreamEvent,
} from '../../../services/contract-api';

/** 执行步骤骨架（contract-risk 固定工具流） */
const EXEC_PLAN = [
  { id: 'cleaner', name: 'contract-cleaner', hint: '清洗合同文本' },
  { id: 'rule', name: 'contract-rule', hint: '扫描法定风险信号' },
  { id: 'irr', name: 'contract-irr', hint: '测算真实年化利率' },
  { id: 'benchmark', name: 'contract-benchmark', hint: '对比市场基准' },
  { id: 'report', name: '_report', hint: '生成体检报告' },
];

/** 工具名 → 中文执行文案（用于自定义工具追加 / 追问进度提示） */
const TOOL_HINT: Record<string, string> = {
  'contract-cleaner': '清洗合同文本…',
  'contract-rule': '扫描法定风险信号…',
  'contract-irr': '测算真实年化利率…',
  'contract-benchmark': '对比市场基准…',
  'law-search': '检索法律条文…',
  'web-search': '联网检索…',
};

type Step = { id: string; name: string; hint: string; status: 'pending' | 'running' | 'done' };

type Msg =
  | { id: number; role: 'user'; kind: 'text' | 'image'; text: string; fullText: string }
  | { id: number; role: 'ai'; kind: 'text'; text: string }
  | { id: number; role: 'ai'; kind: 'plan-run'; hint: string; steps: Step[] }
  | { id: number; role: 'ai'; kind: 'report-card'; report: ContractReport; conversationId: string }
  | { id: number; role: 'ai'; kind: 'progress'; text: string; done: boolean };

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
    const last = wx.getStorageSync('contract_report')?.latest as
      | { scene?: string; conversationId?: string }
      | undefined;
    if (last?.scene) {
      this.setData({
        messages: [
          ...this.data.messages,
          {
            id: nextId(),
            role: 'ai',
            kind: 'text',
            text: `刚才那份「${last.scene}」已体检完成。想看详情在「历史」里点开；想查新合同，直接发我即可。`,
          },
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

  /** 首次分析：一张「步骤执行卡片」展示 5 步，随 SSE 事件点亮；完成后追加报告摘要卡 */
  startAnalyze(text: string) {
    if (this.data.sending) return;
    this.setData({ sending: true });
    const planId = nextId();
    const planMsg: Msg = {
      id: planId,
      role: 'ai',
      kind: 'plan-run',
      hint: '正在分析你的合同…',
      steps: EXEC_PLAN.map((p) => ({ ...p, status: 'pending' as const })),
    };
    this.setData({ messages: [...this.data.messages, planMsg] });
    this.scrollToBottom();

    let conversationId = '';
    let reportSeen = false;
    const self = this;

    const patchPlan = (patch: (s: Step) => Step): void => {
      const messages = this.data.messages.map((m) =>
        m.id === planId && m.kind === 'plan-run'
          ? { ...m, steps: m.steps.map((s) => patch(s)) }
          : m,
      ) as Msg[];
      this.setData({ messages });
    };
    const setStep = (name: string, status: Step['status'], onlyPending = false): void => {
      patchPlan((s) =>
        s.name === name && (!onlyPending || s.status === 'pending')
          ? { ...s, status }
          : s,
      );
    };

    analyzeContractStream(text, '', {
      onEvent: (event: StreamEvent) => {
        if (event.type === 'final' && event.conversationId) {
          conversationId = event.conversationId;
        } else if (event.type === 'tool_call') {
          const name = event.name || '';
          // 骨架项 → running；未预置自定义工具追加到最前
          const has = EXEC_PLAN.some((p) => p.name === name);
          if (!has) {
            const messages = this.data.messages.map((m) =>
              m.id === planId && m.kind === 'plan-run'
                ? {
                    ...m,
                    steps: [
                      {
                        id: `${name}-${Date.now()}`,
                        name,
                        hint: TOOL_HINT[name] || `正在做「${name}」…`,
                        status: 'running' as const,
                      },
                      ...m.steps,
                    ],
                  }
                : m,
            ) as Msg[];
            this.setData({ messages });
          } else {
            setStep(name, 'running');
          }
        } else if (event.type === 'tool_result') {
          const name = event.name || '';
          setStep(name, 'done');
        }
      },
      // 报告正文（JSON）开始 → 点亮"生成体检报告"（正文不逐字展示）
      onDelta: () => {
        if (!reportSeen) {
          reportSeen = true;
          setStep('_report', 'running', true);
        }
      },
      onDone: (report) => {
        const safeReport: ContractReport = {
          scene: report?.scene || '未知',
          conclusion:
            report?.conclusion ||
            '（报告已生成，但内容无法直接结构化展示，请点 [查看完整报告] 跳转查看）',
          signals: report?.signals || [],
          rights: report?.rights,
          loanPlan: report?.loanPlan,
          optimize: report?.optimize,
          keyNumbers: report?.keyNumbers,
          disclaimer: report?.disclaimer,
        };
        try {
          wx.setStorageSync('contract_report', {
            latest: { ...safeReport, conversationId, createdAt: Date.now() },
          });
        } catch {}
        // 卡片收尾：生成报告 → 完成
        const allDone = this.data.messages.map((m) =>
          m.id === planId && m.kind === 'plan-run'
            ? {
                ...m,
                hint: '体检完成，这是你的报告摘要 👇',
                steps: m.steps.map((s) =>
                  s.name === '_report' ? { ...s, status: 'done' as const } : s,
                ),
              }
            : m,
        ) as Msg[];
        const tail: Msg[] = [
          {
            id: nextId(),
            role: 'ai',
            kind: 'report-card',
            report: safeReport,
            conversationId,
          },
          {
            id: nextId(),
            role: 'ai',
            kind: 'text',
            text: '你可以继续在这段对话里问我任何细节，也可以点上方报告卡看完整版。',
          },
        ];
        this.setData({
          sending: false,
          conversationId,
          messages: [...allDone, ...tail],
        });
        this.scrollToBottom();
      },
      onError: (e) => {
        this.setData({
          sending: false,
          messages: [
            ...this.data.messages,
            { id: nextId(), role: 'ai', kind: 'text', text: `分析失败：${e.message}，请稍后重试` },
          ],
        });
        this.scrollToBottom();
      },
    });
  },

  /** 追问：已存在 conversationId 时调用（真 SSE 流式渲染） */
  startFollowUp(question: string) {
    if (this.data.sending) return;
    if (!this.data.conversationId) return;
    this.setData({ sending: true });
    const aiId = nextId();
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
    const pushProgress = (pid: number, text: string, done: boolean) => {
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
            pushProgress(pid, `🔧 ${TOOL_HINT[name] || `正在调用「${name}」…`}`, false);
          }
        } else if (event.type === 'tool_result') {
          for (const [name, pid] of toolBubbleMap.entries()) {
            const m = self.data.messages.find((x) => x.id === pid);
            if (m && 'kind' in m && m.kind === 'progress' && !m.done) {
              pushProgress(pid, `✅ 「${name}」完成`, true);
              break;
            }
          }
        } else if (event.type === 'start') {
          replaceText('正在思考你的问题…');
        }
      },
      onDelta: (delta) => {
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
    const msg = this.data.messages.find(
      (m) => 'kind' in m && m.kind === 'report-card' && m.id === id,
    ) as Extract<Msg, { kind: 'report-card' }> | undefined;
    if (!msg) return;
    wx.navigateTo({ url: `/pages/contract/result/result?conversationId=${msg.conversationId}` });
  },

  /** [继续追问]：提示在输入框继续发问 */
  onContinueChat() {
    wx.showToast({ title: '在下方输入框继续发问', icon: 'none' });
  },

  /** 工具：按 id 替换 AI 文本消息 */
  replaceText(aiId: number, text: string): Msg[] {
    return this.data.messages.map((m) =>
      m.id === aiId && 'kind' in m && m.kind === 'text' ? { ...m, text } : m,
    ) as Msg[];
  },
  /** 工具：追加一条追问阶段的进度小胶囊（独立展示） */
  appendProgress(pid: number, text: string, done: boolean): Msg[] {
    return [
      ...this.data.messages,
      { id: pid, role: 'ai' as const, kind: 'progress' as const, text, done },
    ];
  },

  scrollToBottom() {
    setTimeout(() => {
      try {
        wx.pageScrollTo({ scrollTop: 999999, duration: 200 });
      } catch {}
    }, 80);
  },
});

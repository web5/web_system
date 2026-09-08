/**
 * 合同翻译官 - 解读中
 *
 * 按 v5 原型稿实现（思考卡 + 时序）：
 *  1. 思考阶段：模型 reasoning 流（reasoning_delta）流入「AI 正在思考」低矮卡（固定高可滚）。
 *  2. 首个 tool_call 到达（= 思考完成、决定要做什么）：
 *     - 思考卡收起为一行「AI 已完成思考」摘要
 *     - 此刻才渲染执行步骤骨架（步骤是思考得出的产物），并点亮第一个工具
 *  3. 工具逐项 running→done；报告轮 content_delta 到达 →「生成体检报告」running + "已生成 N 字" 跳动
 *  4. onDone 落报告并跳 result
 */
import { analyzeContractStream, StreamEvent } from '../../../services/contract-api';

/** 思考结束后才出现的执行步骤骨架（contract-risk 固定工具流） */
const EXEC_PLAN = [
  { id: 'rule', name: 'contract-rule', hint: '扫描法定风险信号' },
  { id: 'irr', name: 'contract-irr', hint: '测算真实年化利率' },
  { id: 'benchmark', name: 'contract-benchmark', hint: '对比市场基准' },
  { id: 'report', name: '_report', hint: '生成体检报告' },
];

Page({
  data: {
    /** 动态子标题（sub）：思考期→执行期→报告字数 */
    thinkingText: '正在读取合同内容…',
    /** 执行步骤骨架：思考完成（首个 tool_call）后才出现 */
    toolSteps: [] as Array<{ id: string; name: string; hint: string; status: 'pending' | 'running' | 'done' }>,
    /** 思考区：open=展示正文（固定高可滚）/ done=已结束（标题变"已完成"，默认收起） */
    think: { open: true, done: false, text: '' },
  },

  // 工具名 → 用户文案映射
  toolTextMap: {
    'contract-cleaner': '正在清洗合同文本…',
    'contract-rule': '正在扫描法定风险信号…',
    'contract-irr': '正在测算真实年化利率…',
    'contract-benchmark': '正在对比市场基准…',
    'law-search': '正在检索法律条文…',
    'web-search': '正在联网检索…',
  } as Record<string, string>,

  // 思考期（reasoning 首个 delta 到达前）的兜底轮换文案
  fallbackList: [
    'AI 正在认真看你的合同…',
    '正在梳理关键条款…',
    '马上就好，再等一下',
  ],

  onLoad() {
    this.startAnalysis();
  },

  startAnalysis() {
    const pending = wx.getStorageSync('contract_pending') as
      | { text?: string; scene?: string }
      | undefined;
    const text = pending?.text || '';
    const scene = pending?.scene;

    if (!text) {
      wx.showToast({ title: '缺少待分析内容', icon: 'none' });
      setTimeout(() => this.redirectResult(), 1500);
      return;
    }

    this.startFallbackRotation();

    analyzeContractStream(text, scene, {
      onEvent: (event: StreamEvent) => this.handleSseEvent(event),
      // 思考增量：节流追加到思考卡（执行开始后的报告轮思考不再打扰）
      onReasoning: (delta) => this.appendThinking(delta),
      // 报告正文增量：报告轮 running → "已生成 N 字"
      onDelta: (delta) => this.countReportWords(delta),
      onDone: (report) => {
        if ((this as any)._thinkTimer) clearTimeout((this as any)._thinkTimer);
        if ((this as any)._wordTimer) clearTimeout((this as any)._wordTimer);
        (this as any)._thinkBuf = '';
        (this as any)._wordBuf = 0;
        // 存储报告供 result 页读取
        const storage = wx.getStorageSync('contract_report') || {};
        storage.latest = {
          ...report,
          conversationId: (this as any).conversationId || '',
          createdAt: Date.now(),
        };
        wx.setStorageSync('contract_report', storage);
        this.setData({
          thinkingText: '体检完成，正在打开报告…',
          toolSteps: this.data.toolSteps.map((s) => ({ ...s, status: 'done' })),
        });
        this.redirectResult();
      },
      onError: (err) => {
        wx.showToast({ title: err.message || '分析失败', icon: 'none' });
        setTimeout(() => this.redirectResult(), 1500);
      },
    });
  },

  /** 思考增量：节流追加到思考卡；已进入执行阶段（toolSteps 非空）后忽略后续轮的思考 */
  appendThinking(delta: string) {
    if (this.data.toolSteps.length > 0) return;
    this.stopFallback();
    (this as any)._thinkBuf = ((this as any)._thinkBuf || '') + delta;
    if ((this as any)._thinkTimer) return;
    (this as any)._thinkTimer = setTimeout(() => {
      (this as any)._thinkTimer = null;
      const txt: string = (this as any)._thinkBuf || '';
      this.setData({
        thinkingText: 'AI 正在思考…',
        think: { open: true, done: false, text: txt },
      });
    }, 150);
  },

  /** 报告正文增量：确保"生成体检报告"running，并显示"已生成 N 字" */
  countReportWords(delta: string) {
    (this as any)._wordBuf = ((this as any)._wordBuf || 0) + delta.length;
    if ((this as any)._wordTimer) return;
    (this as any)._wordTimer = setTimeout(() => {
      (this as any)._wordTimer = null;
      // 收到正文 = LLM 已开始输出报告，点亮"生成体检报告"
      const toolSteps = this.data.toolSteps.map((s) =>
        s.name === '_report' && s.status === 'pending'
          ? { ...s, status: 'running' as const }
          : s,
      );
      this.setData({
        toolSteps,
        thinkingText: `AI 正在写报告，已生成 ${(this as any)._wordBuf || 0} 字…`,
      });
    }, 150);
  },

  /** 点击思考卡标题：展开 / 收起 */
  toggleThink() {
    this.setData({ think: { ...this.data.think, open: !this.data.think.open } });
  },

  /** SSE 事件：首个 tool_call = 思考完成 → 渲染步骤骨架；tool_result/final 更新状态 */
  handleSseEvent(event: StreamEvent) {
    if (event.type === 'final' && event.conversationId) {
      (this as any).conversationId = event.conversationId;
      return;
    }

    if (event.type === 'tool_call') {
      this.stopFallback();
      const toolName = event.name || '';
      const hint = this.toolTextMap[toolName] || `正在做「${toolName}」…`;

      // 首次 tool_call：思考完成 → 收起思考卡 + 列出执行骨架（步骤是思考得出的产物）
      if (this.data.toolSteps.length === 0) {
        const inPlan = EXEC_PLAN.some((p) => p.name === toolName);
        const toolSteps = inPlan
          ? EXEC_PLAN.map((p) =>
              p.name === toolName ? { ...p, status: 'running' as const } : { ...p, status: 'pending' as const },
            )
          : [...EXEC_PLAN.map((p) => ({ ...p, status: 'pending' as const }))];
        if (!inPlan) {
          toolSteps.push({ id: `${toolName}-${Date.now()}`, name: toolName, hint, status: 'running' });
        }
        this.setData({
          toolSteps,
          thinkingText: hint,
          think: { ...this.data.think, done: true, open: false },
        });
        return;
      }

      // 后续工具：预置项置 running；未预置自定义工具追加
      const toolSteps = this.data.toolSteps.map((s) =>
        s.name === toolName && s.status !== 'done' ? { ...s, status: 'running' as const } : s,
      );
      if (!toolSteps.some((s) => s.name === toolName)) {
        toolSteps.push({
          id: `${toolName}-${Date.now()}`,
          name: toolName,
          hint,
          status: 'running' as const,
        });
      }
      this.setData({ toolSteps, thinkingText: hint });
    } else if (event.type === 'tool_result') {
      const toolName = event.name || '';
      const targetIdx = toolName
        ? this.data.toolSteps.findIndex((s) => s.name === toolName && s.status === 'running')
        : this.data.toolSteps.findIndex((s) => s.status === 'running');
      const toolSteps =
        targetIdx >= 0
          ? this.data.toolSteps.map((s, i) => (i === targetIdx ? { ...s, status: 'done' as const } : s))
          : this.data.toolSteps;
      this.setData({ toolSteps });
    }
  },

  /** 兜底文案轮换（思考期无 reasoning 时避免界面静止） */
  startFallbackRotation() {
    if ((this as any).fallbackTimer) return;
    let idx = 0;
    (this as any).fallbackTimer = setInterval(() => {
      idx = (idx + 1) % this.fallbackList.length;
      this.setData({ thinkingText: this.fallbackList[idx] });
    }, 4000);
  },

  stopFallback() {
    if ((this as any).fallbackTimer) {
      clearInterval((this as any).fallbackTimer);
      (this as any).fallbackTimer = null;
    }
  },

  redirectResult() {
    this.stopFallback();
    wx.redirectTo({ url: '/pages/contract/result/result' });
  },

  onUnload() {
    this.stopFallback();
    if ((this as any)._thinkTimer) clearTimeout((this as any)._thinkTimer);
    if ((this as any)._wordTimer) clearTimeout((this as any)._wordTimer);
  },
});

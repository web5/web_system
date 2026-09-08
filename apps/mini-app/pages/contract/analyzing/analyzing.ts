/**
 * 合同翻译官 - 解读中
 *
 * 按 v5 原型稿高保真实现：
 *  1. 思考阶段：AI 思考状态条 = 单行收缩（默认不展开正文），右上「查看完整思考 ›」
 *     点击后从底部抽屉（mask + sheet）展示完整思考内容（内容流式追加并自动滚底）。
 *  2. 思考完成：状态条整体变绿（done），此时才列出执行步骤（步骤是思考得出的产物）。
 *  3. 执行阶段：步骤逐项 pending(灰)→running(蓝)→done(绿)；报告轮 content_delta →
 *     "生成体检报告"running + "已生成 N 字"跳动。
 *  4. onDone 落报告并跳 result。
 */
import { analyzeContractStream, StreamEvent } from '../../../services/contract-api';

/** 执行步骤骨架（contract-risk 固定工具流）：思考完成后才列出 */
const EXEC_PLAN = [
  { id: 'cleaner', name: 'contract-cleaner', hint: '清洗合同文本' },
  { id: 'rule', name: 'contract-rule', hint: '扫描法定风险信号' },
  { id: 'irr', name: 'contract-irr', hint: '测算真实年化利率' },
  { id: 'benchmark', name: 'contract-benchmark', hint: '对比市场基准' },
  { id: 'report', name: '_report', hint: '生成体检报告' },
];

Page({
  data: {
    /** 动态子标题（sub）：思考中/执行中/报告字数 */
    thinkingText: '正在读取合同内容…',
    /** 执行步骤骨架：思考完成（首个 tool_call）后才出现 */
    toolSteps: [] as Array<{
      id: string;
      name: string;
      hint: string;
      status: 'pending' | 'running' | 'done';
    }>,
    /** 思考状态条：done=已完成（绿色）；text=全文缓存（抽屉展示） */
    think: { done: false, text: '' },
    /** 思考全文抽屉是否打开 */
    thinkDrawer: false,
    /** 抽屉 scroll-view 滚动位置（全文追加自动到底） */
    thinkScrollTop: 0,
  },

  // 工具名 → 用户文案映射
  toolTextMap: {
    'contract-cleaner': '清洗合同文本…',
    'contract-rule': '扫描法定风险信号…',
    'contract-irr': '测算真实年化利率…',
    'contract-benchmark': '对比市场基准…',
    'law-search': '检索法律条文…',
    'web-search': '联网检索…',
  } as Record<string, string>,

  // 思考期（reasoning 首个 delta 到达前）兜底轮换文案
  fallbackList: ['AI 正在认真看你的合同…', '正在梳理关键条款…', '马上就好，再等一下'],

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
      // 思考增量：节流缓存全文；执行开始后（toolSteps 非空）忽略后续轮思考
      onReasoning: (delta) => this.appendThinking(delta),
      // 报告正文增量：字数跳动
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
          toolSteps: this.data.toolSteps.map((s) => ({ ...s, status: 'done' as const })),
        });
        this.redirectResult();
      },
      onError: (err) => {
        wx.showToast({ title: err.message || '分析失败', icon: 'none' });
        setTimeout(() => this.redirectResult(), 1500);
      },
    });
  },

  /** 思考增量：节流缓存全文（think.text），若抽屉开着则自动滚底 */
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
        think: { done: false, text: txt },
        thinkScrollTop: txt.length,
      });
    }, 150);
  },

  /** 报告正文增量：确保"生成体检报告"running 并显示字数 */
  countReportWords(delta: string) {
    (this as any)._wordBuf = ((this as any)._wordBuf || 0) + delta.length;
    if ((this as any)._wordTimer) return;
    (this as any)._wordTimer = setTimeout(() => {
      (this as any)._wordTimer = null;
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

  /** 打开思考全文抽屉 */
  onOpenThink() {
    this.setData({
      thinkDrawer: true,
      thinkScrollTop: (this.data.think.text || '').length,
    });
  },

  /** 关闭思考全文抽屉 */
  onCloseThink() {
    this.setData({ thinkDrawer: false });
  },

  /** 拦截事件冒泡（mask 内点击 sheet 不关闭） */
  noop() {},

  /** SSE 事件：首个 tool_call = 思考完成 → 渲染执行步骤骨架 */
  handleSseEvent(event: StreamEvent) {
    if (event.type === 'final' && event.conversationId) {
      (this as any).conversationId = event.conversationId;
      return;
    }

    if (event.type === 'tool_call') {
      this.stopFallback();
      const toolName = event.name || '';
      const hint = this.toolTextMap[toolName] || `正在做「${toolName}」…`;

      // 首次 tool_call：思考完成 → 状态条变绿 + 列出执行骨架
      if (this.data.toolSteps.length === 0) {
        const inPlanIdx = EXEC_PLAN.findIndex((p) => p.name === toolName);
        let toolSteps: Array<{
          id: string;
          name: string;
          hint: string;
          status: 'pending' | 'running' | 'done';
        }> = EXEC_PLAN.map((p) => ({ ...p, status: 'pending' as const }));
        if (inPlanIdx >= 0) {
          toolSteps[inPlanIdx] = { ...toolSteps[inPlanIdx], status: 'running' as const };
        } else {
          // 未预置的自定义工具（law-search 等）插到最前执行
          toolSteps.unshift({
            id: `${toolName}-${Date.now()}`,
            name: toolName,
            hint,
            status: 'running',
          });
        }
        this.setData({
          toolSteps,
          thinkingText: hint,
          think: { ...this.data.think, done: true },
        });
        return;
      }

      // 后续工具：预置项置 running；未预置追加到最前
      const toolSteps = this.data.toolSteps.map((s) =>
        s.name === toolName && s.status !== 'done' ? { ...s, status: 'running' as const } : s,
      );
      if (!toolSteps.some((s) => s.name === toolName)) {
        toolSteps.unshift({
          id: `${toolName}-${Date.now()}`,
          name: toolName,
          hint,
          status: 'running',
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
          ? this.data.toolSteps.map((s, i) =>
              i === targetIdx ? { ...s, status: 'done' as const } : s,
            )
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

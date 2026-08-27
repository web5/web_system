/**
 * 合同翻译官 - 解读中
 * 基于 SSE 事件流动态更新"AI 思考中"文案（真实反映 AI 当前步骤）。
 * 4 步进度动画 + 事件驱动文案，完成后跳转 result 页。
 */
import { analyzeContractStream, StreamEvent } from '../../../services/contract-api';

Page({
  data: {
    steps: [
      { text: '识别合同文本', desc: 'OCR 识别条款内容', done: true, active: false },
      { text: '判断合同类型', desc: '识别消费贷 / 保险 / 租房', done: false, active: true },
      { text: '测算关键数字', desc: '真实年化利率 · 费用测算', done: false, active: false },
      { text: '生成风险报告', desc: '风险信号 · 权益雷达', done: false, active: false },
    ],
    thinkingText: '',
    // 流式生成：LLM 逐字生成报告内容，实时展示（展示原始 JSON 文本增量）
    streamingText: '',
    streamingVisible: false,
  },

  // 工具名 → 用户文案映射（真实反映 agent 当前步骤）
  toolTextMap: {
    'contract-cleaner': '正在清洗 OCR 识别噪声...',
    'contract-rule': '正在扫描法定风险信号...',
    'contract-irr': '正在测算真实年化利率...',
  } as Record<string, string>,

  // 兜底文案（未识别到 tool_call 时轮换）
  fallbackList: [
    'AI 正在分析合同条款...',
    '正在整理风险报告...',
    'AI 正在深度思考，请稍候...',
  ],

  onLoad() {
    // 4 步进度动画
    this.startStepAnimation();

    // 从 storage 读取待分析内容并启动流式分析
    this.startAnalysis();
  },

  /** 4 步进度动画（前 3 步模拟，第 4 步"生成报告"由事件驱动真实状态） */
  startStepAnimation() {
    let step = 1;
    const timer = setInterval(() => {
      if (step >= 4) {
        clearInterval(timer);
        return;
      }
      const steps = this.data.steps.map((s: any, i: number) => ({
        ...s,
        done: i < step,
        active: i === step,
      }));
      this.setData({ steps });
      step++;
    }, 1200);
  },

  /** 启动流式分析，按 SSE 事件更新文案 */
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

    // 启动兜底文案轮换（收到 tool_call 事件后自动停止）
    this.setData({ thinkingText: 'AI 正在开始分析...' });
    this.startFallbackRotation();

    analyzeContractStream(text, scene, {
      onEvent: (event: StreamEvent) => this.handleSseEvent(event),
      // 流式增量：LLM 逐字生成报告内容，实时展示
      onDelta: (delta) => {
        if (!(this as any).streamAcc) (this as any).streamAcc = '';
        (this as any).streamAcc += delta;
        this.setData({
          streamingVisible: true,
          streamingText: (this as any).streamAcc,
        });
      },
      onDone: (report) => {
        // 存储报告供 result 页读取（含 conversationId，供后续追问复用同一上下文）
        const storage = wx.getStorageSync('contract_report') || {};
        storage.latest = {
          ...report,
          conversationId: (this as any).conversationId || '',
          createdAt: Date.now(),
        };
        wx.setStorageSync('contract_report', storage);
        this.setData({ thinkingText: '报告生成完成' });
        this.redirectResult();
      },
      onError: (err) => {
        wx.showToast({ title: err.message || '分析失败', icon: 'none' });
        setTimeout(() => this.redirectResult(), 1500);
      },
    });
  },

  /** 根据 SSE 事件更新进度步骤与文案 */
  handleSseEvent(event: StreamEvent) {
    // 记录 final 事件携带的会话 id，供 result 页追问复用
    if (event.type === 'final' && event.conversationId) {
      (this as any).conversationId = event.conversationId;
    }
    if (event.type === 'tool_call') {
      // 事件驱动后停止兜底轮换，避免覆盖真实文案
      this.stopFallback();
      const toolName = event.name || '';
      // 第 3 步（测算）done，第 4 步（生成报告）active
      const steps = this.data.steps.map((s: any, i: number) => ({
        ...s,
        done: i < 3,
        active: i === 3,
      }));
      this.setData({
        steps,
        thinkingText: this.toolTextMap[toolName] || `正在执行${toolName}...`,
      });
    } else if (event.type === 'tool_result') {
      // 工具执行完成，保持"正在整理"文案
      this.setData({ thinkingText: '正在整理分析结果...' });
    } else if (event.type === 'start') {
      this.setData({ thinkingText: 'AI 正在开始分析...' });
    }
  },

  /** 兜底文案轮换（长时间无 tool_call 事件时，避免界面静止） */
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
    (this as any).streamAcc = '';
  },
});

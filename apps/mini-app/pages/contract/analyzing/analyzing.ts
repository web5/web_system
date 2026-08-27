/**
 * 合同翻译官 - 解读中
 * 4 步进度动画，分析完成后由 upload 页 redirectTo 到 result 页。
 * 当 AI 生成报告较慢时，显示动态"思考中"提示，避免用户以为卡死。
 */
Page({
  data: {
    steps: [
      { text: '识别合同文本', desc: 'OCR 识别条款内容', done: true, active: false },
      { text: '判断合同类型', desc: '识别消费贷 / 保险 / 租房', done: false, active: true },
      { text: '测算关键数字', desc: '真实年化利率 · 费用测算', done: false, active: false },
      { text: '生成风险报告', desc: '风险信号 · 权益雷达', done: false, active: false },
    ],
    thinkingText: '',
    thinkingIndex: 0,
  },

  onLoad() {
    const thinkingList = [
      'AI 正在分析合同条款...',
      '正在扫描法定风险信号...',
      '正在测算真实年化利率...',
      '正在整理风险报告...',
      'AI 正在深度思考，请稍候...',
    ];

    // 逐步推进进度动画
    let step = 1;
    const stepTimer = setInterval(() => {
      if (step >= 4) {
        clearInterval(stepTimer);
        // 到第 4 步（生成报告），启动"思考中"动态提示
        this.setData({ thinkingText: thinkingList[0] });
        this.startThinking(thinkingList);
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

  /** 第 4 步轮换"思考中"提示文案 */
  startThinking(list: string[]) {
    // 存到 data 上避免 TS 报错（小程序 Page 实例自定义属性）
    (this as any).thinkingTimer = setInterval(() => {
      const next = (this.data.thinkingIndex + 1) % list.length;
      this.setData({ thinkingIndex: next, thinkingText: list[next] });
    }, 4000);
  },

  onUnload() {
    // 清理定时器
    const timer = (this as any).thinkingTimer;
    if (timer) {
      clearInterval(timer);
      (this as any).thinkingTimer = null;
    }
  },
});

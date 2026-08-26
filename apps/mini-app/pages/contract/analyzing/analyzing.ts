/**
 * 合同翻译官 - 解读中
 * 4 步进度动画，分析完成后由 upload 页 redirectTo 到 result 页
 */
Page({
  data: {
    steps: [
      { text: '识别合同文本', desc: 'OCR 识别条款内容', done: true, active: false },
      { text: '判断合同类型', desc: '识别消费贷 / 保险 / 租房', done: false, active: true },
      { text: '测算关键数字', desc: '真实年化利率 · 费用测算', done: false, active: false },
      { text: '生成风险报告', desc: '风险信号 · 权益雷达', done: false, active: false },
    ],
  },

  onLoad() {
    // 逐步推进进度动画
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
    }, 1500);
  },
});

/**
 * 功能设置页（发现页暗门进入，也可直访 URL —— 页面全中性文案、开关默认关，直访不构成露出）。
 *
 * 设计凭证：PRD v0.2 §4.3（01-PRD-功能隐藏与远端开关.md）。
 * 开关语义见 utils/feature-flags.ts：纯本地 storage，无网络请求；
 * 变更即时生效（写 storage → 广播 flags:updated → 首页/发现页/我的页重渲染），不弹 toast。
 */
import { featureEnabled, setFeatureEnabled } from '../../../utils/feature-flags';

/** switch 组件 change 事件最小结构 */
interface SwitchChangeEvent {
  detail?: { value?: boolean };
}

Page({
  data: {
    /** 圆角风格：页面根节点叠加的 class（app.wxss 的 .radius-* 覆盖类驱动） */
    radiusClass: '',
    /** 「对话练习」开关（localFeature.chat） */
    chat: false,
    /** 「文本翻译」开关（localFeature.translate） */
    translate: false,
  },

  onShow() {
    const __app = getApp<IAppOption>();
    const __cls = __app.radiusClassOf ? __app.radiusClassOf() : '';
    if (__cls !== this.data.radiusClass) this.setData({ radiusClass: __cls });

    // 每次进页以 storage 为准回显（直访/返回都拿到最新状态）
    this.setData({ chat: featureEnabled('chat'), translate: featureEnabled('translate') });
  },

  onToggleChat(e: SwitchChangeEvent) {
    const on = !!(e.detail && e.detail.value);
    setFeatureEnabled('chat', on);
    this.setData({ chat: featureEnabled('chat') });
  },

  onToggleTranslate(e: SwitchChangeEvent) {
    const on = !!(e.detail && e.detail.value);
    setFeatureEnabled('translate', on);
    this.setData({ translate: featureEnabled('translate') });
  },
});

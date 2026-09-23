/**
 * 能力清单（C 端展示用）
 *
 * 发现页卡片与左栏下半区「能力」共用同一份配置，避免两处漂移。
 * 数据源目前**写死**（Q3 拍板）：后端 B2（`agent_definitions` 展示元数据 + C 端清单接口）
 * 就绪后替换为接口数据，展示字段保持不变。
 */
import type { IconName } from './icons';

export interface Capability {
  /** 能力名（展示名） */
  name: string;
  /** 一句能力说明 */
  desc: string;
  icon: IconName;
  /** 落地页路由；未开放能力为空串 */
  to: string;
  enabled: boolean;
}

export const CAPABILITIES: Capability[] = [
  {
    name: '语言翻译官',
    desc: '三版译文对照 + 语气点评，支持 12 种语言',
    icon: 'lang',
    to: '/translate',
    enabled: true,
  },
  {
    name: '合同翻译官',
    desc: '上传合同自动识别风险信号、法律依据与可争取权益',
    icon: 'doc',
    to: '/contract',
    enabled: true,
  },
  { name: '论文速读', desc: '上传论文，提取核心结论与方法', icon: 'search', to: '', enabled: false },
  { name: '文案改写', desc: '按平台与受众重写营销文案', icon: 'grid', to: '', enabled: false },
];

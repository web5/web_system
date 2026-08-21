/**
 * AI 领域关键词分类——离线、确定性兜底。
 * 用途：给 AI 资讯条目打 category 标签（LLM 分类失败或未启用时兜底）。
 * 参考 finnews/processors/sectors.ts 的板块关键词模式。
 */

export const AI_CATEGORY_KEYWORDS: Record<string, string[]> = {
  大模型: ['大模型', 'LLM', 'GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', '通义', '文心', '混元', '基础模型', 'foundation model'],
  Agent: ['Agent', '智能体', 'Multi-Agent', '工作流', 'agent'],
  具身智能: ['具身智能', '机器人', '人形机器人', 'embodied', '机械臂'],
  开源: ['开源', 'open source', '开放权重', 'open weights', '开源模型'],
  算力: ['算力', 'GPU', '芯片', 'H100', 'A100', 'B200', '训练', '推理', '数据中心', '英伟达', 'NVIDIA'],
  多模态: ['多模态', '视觉', 'VLM', '视频生成', '图像生成', 'Sora', '扩散模型', 'diffusion', '文生图', '文生视频'],
  产品发布: ['发布', '上线', '推出', 'launch', 'release', 'GA'],
  融资: ['融资', '估值', '投资', '收购', 'IPO', 'funding', '新一轮'],
  学术: ['论文', 'arXiv', 'benchmark', '数据集', 'SOTA', '研究', '顶会', 'CVPR', 'NeurIPS', 'ICML'],
};

/** 根据标题 + 正文命中 AI 细分领域（可能多个，去重返回） */
export function detectAiCategories(title: string, content: string): string[] {
  const haystack = `${title}\n${content ?? ''}`;
  const hit = new Set<string>();
  for (const [category, keywords] of Object.entries(AI_CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => haystack.toLowerCase().includes(kw.toLowerCase()))) {
      hit.add(category);
    }
  }
  return [...hit];
}

import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ClientRegistry } from '@kedouai/agent-core';
import { AiAgentServiceKeyGuard } from './ai-agent-service-key.guard';
import { MemorySummaryRequestDto } from './dto/memory-summary-request.dto';

/**
 * ai-agent internal LLM 端点（服务间，不经 gateway）。
 *
 * 背景（#8229 架构修正，用户 2026-10-30 拍板）：LLM 调用统一走 ai-agent 的
 * AI 服务通道（ClientRegistry / TokenHub 托管模型），密钥由配置中心下发——
 * user-service 不直连 TokenHub、不持有 LLM 密钥，职责只到「存储摘要行 + 幂等 rebuild 编排」。
 *
 * 首个端点：用户记忆摘要生成。user-service 在 rebuild 时调用（x-service-key 鉴权）；
 * 调用失败/超时由 user-service 回落确定性模板聚合，本端点失败不阻断其链路。
 *
 * ⚠️ 回环说明：调用链为 ai-agent hook → user-service refresh → 本端点。
 * 本端点是一次无状态的 LLM 补全，不产生 run、不触发 PostRunHook（钩子只在
 * AgentRunner 对话轮次结束后触发），user-service rebuild 也不再回调 refresh
 * —— 回环深度恒为 1，无死循环风险。
 */
@ApiTags('internal')
@Controller('internal')
@UseGuards(AiAgentServiceKeyGuard)
export class LlmInternalController {
  private readonly logger = new Logger(LlmInternalController.name);

  /** 与用户记忆提炼（UserMemoryUpdateHook）同一模型：MEMORY_EXTRACT_MODEL */
  private readonly extractModel?: string;

  constructor(
    private readonly clientRegistry: ClientRegistry,
    configService: ConfigService,
  ) {
    this.extractModel = configService.get<string>('MEMORY_EXTRACT_MODEL');
  }

  @Post('llm/memory-summary')
  @ApiOperation({ summary: '用户记忆摘要生成（明细集 → 结构化画像文本）' })
  @HttpCode(HttpStatus.OK)
  async memorySummary(@Body() dto: MemorySummaryRequestDto) {
    const items = (dto.items ?? []).filter((it) => it && it.content?.trim());
    if (!items.length) {
      return { summary: '', model: null, itemCount: dto.itemCount ?? 0 };
    }
    const lines = items
      .map((d) => `- [${d.category}] ${d.content.trim()}`)
      .join('\n');
    // 🔴 格式口径（#8273）：摘要正文会被前端**原样转义渲染**（`{{ }}` 插值、禁 v-html，
    // 防 LLM 半可信输入注入 HTML），所以任何 markdown 语法都不会被渲染、只会露出
    // 井号/短线/星号。故此处强制输出纯文本多行，不用 # 标题、不用 - 列表、不用 ** 加粗。
    // 另：卡片 meta 已单独展示「条数 / 更新时间」，正文再写一遍「共 N 条记忆」是重复噪音，故不再要求。
    const system =
      '你是用户记忆摘要生成器。把「记忆明细」压缩成一段中文用户画像，要求：\n' +
      '1. 输出 2–4 行纯文本，每行以「· 」开头（中点+空格），行与行之间不要空行；\n' +
      '2. 每行格式「· 分类：内容」，分类只用 事实 / 偏好 / 习惯 三个词；同一分类的多条合并成一行，用「；」分隔；\n' +
      '3. 保留稳定事实（姓名、城市、职业、长期偏好），不逐条罗列对话细节；\n' +
      '4. 禁止任何 markdown 语法：不要 # 标题、不要 - 或 * 列表符、不要 ** 加粗、不要代码块、不要表格；\n' +
      '5. 总长不超过 450 字，只输出摘要正文本身，不要开场白和收尾语。';
    const user = `明细数：${dto.itemCount ?? items.length}\n记忆明细：\n${lines}`;

    const client = this.clientRegistry.getOrFallback(this.extractModel);
    const text = await client.chat(
      [
        { role: 'system', content: system, ts: Date.now() },
        { role: 'user', content: user, ts: Date.now() },
      ],
      { temperature: 0.2, maxTokens: 800 },
    );
    this.logger.log(
      `记忆摘要生成: userId=${dto.userId ?? '?'} items=${items.length} model=${client.modelId} len=${text?.length ?? 0}`,
    );
    return { summary: (text ?? '').trim(), model: client.modelId, itemCount: dto.itemCount ?? items.length };
  }
}

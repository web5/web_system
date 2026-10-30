// class-validator 的装饰器依赖 reflect-metadata 提供的 Reflect.getMetadata
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveAgentDefDto } from './agent-def.dto';

/**
 * SaveAgentDefDto 白名单回归（2026-10-30 hotfix）。
 *
 * 背景：`main.ts` 的全局 ValidationPipe 是
 * `{ whitelist: true, forbidNonWhitelisted: true }` —— **DTO 没声明的字段直接 400**。
 * admin 表单 `defaultAgentForm()` 恒定携带 `description: ''` 与 `keywords: []`，
 * 而 `AgentDefService.create/update` 又会读 `payload.description` / `payload.keywords` 落库。
 * DTO 曾漏声明这两个字段（2026-09-28 前端加字段起），导致：
 *
 *   PUT /api/agent-defs/:id  → 400 {"code":"4000","message":"property description should not exist; property keywords should not exist"}
 *
 * 也就是「新建 / 保存草稿」两条路径 100% 失败。本用例锁住该回归。
 */

/** 与 main.ts 全局 ValidationPipe 同款参数——必须一致，否则测不出真实行为 */
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

/** admin 表单实际提交的形状（含 description/keywords，其余按 DTO 必填项补齐） */
function adminFormPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'general',
    name: '通用助手',
    systemPrompt: '你是通用助手',
    model: 'hy3',
    tools: [],
    capabilities: [],
    maxSteps: 8,
    temperature: 0.7,
    maxTokens: null,
    topP: null,
    thinking: null,
    memory: { compactionThreshold: 20, keepRecent: 6, enabled: true },
    streaming: true,
    // ↓ admin 表单恒定带这两个字段，曾因 DTO 缺声明被 forbidNonWhitelisted 拒掉
    description: '',
    keywords: [],
    ...overrides,
  };
}

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(SaveAgentDefDto, payload);
  const errors = await validate(dto, { ...PIPE_OPTIONS });
  // 复刻 ValidationPipe 在 forbidNonWhitelisted 下的报错文案，便于断言
  const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
  return { errors, messages };
}

describe('SaveAgentDefDto 白名单', () => {
  it('🔴 admin 表单原样提交（带 description/keywords）应通过——回归锁', async () => {
    const { messages } = await validatePayload(adminFormPayload());
    expect(messages).toEqual([]);
  });

  it('description / keywords 可省略（向后兼容旧前端与 internal 调用）', async () => {
    const payload = adminFormPayload();
    delete payload.description;
    delete payload.keywords;
    const { messages } = await validatePayload(payload);
    expect(messages).toEqual([]);
  });

  it('description 为 null / keywords 为 null 时通过（service 层按 null 落库）', async () => {
    const { messages } = await validatePayload(adminFormPayload({ description: null, keywords: null }));
    expect(messages).toEqual([]);
  });

  it('description 类型错误要拦住（不能因为放开白名单就放过类型）', async () => {
    const { messages } = await validatePayload(adminFormPayload({ description: 123 }));
    expect(messages.join(' ')).toContain('description');
  });

  it('keywords 不是字符串数组要拦住', async () => {
    const { messages } = await validatePayload(adminFormPayload({ keywords: [1, 2] }));
    expect(messages.join(' ')).toContain('keywords');
  });

  it('真正的未知字段仍被拒（证明没把 forbidNonWhitelisted 放松）', async () => {
    const { messages } = await validatePayload(adminFormPayload({ totallyUnknownField: 'x' }));
    expect(messages.join(' ')).toContain('totallyUnknownField');
  });

  it('C7 调参三字段（maxTokens/topP/thinking）与描述线索可同时提交', async () => {
    const { messages } = await validatePayload(
      adminFormPayload({
        maxTokens: 1024,
        topP: 0.9,
        thinking: { type: 'enabled', budget_tokens: 2048 },
        description: '用于把任意文本翻译成目标语言',
        keywords: ['翻译', 'translate'],
      }),
    );
    expect(messages).toEqual([]);
  });
});

/**
 * 对话结束后的「后置钩子」插件接口。
 *
 * 由 AgentController.handleRun 在 SSE res.end() 之后 fire-and-forget 调用，
 * 不阻塞对话响应。用户记忆更新（UserMemoryUpdateHook）是第一个实现；
 * 未来「行为分析」「收藏推荐」等后置逻辑都实现本接口并挂进钩子列表。
 */

/** 单步事件（对齐 controller 里收集的 steps，不含 content_delta/reasoning_delta） */
export interface PostRunStep {
  type: string;
  name?: string;
  content?: string;
  step?: number;
  ts?: number;
  usage?: unknown;
}

export interface PostRunContext {
  userId: string;
  conversationId: string | null;
  userInput: string;
  finalAnswer: string | null;
  steps: PostRunStep[];
  source: 'chat' | 'tool';
}

export interface PostRunHook {
  /** 插件名（日志标识） */
  name: string;
  /** 后置处理，抛错由调用方吞掉（fire-and-forget），绝不影响主链路 */
  trigger(ctx: PostRunContext): Promise<void>;
}

/** Nest 注入 token：PostRunHook 数组（在 AgentModule 以 provider 提供，便于增删插件） */
export const POST_RUN_HOOKS = Symbol('POST_RUN_HOOKS');

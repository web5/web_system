// AGUI（Agent-UI / ag-ui protocol，CopilotKit 提出的 Agent-UI 事件协议）核心事件子集。
// 本 demo 实现其中与前端渲染强相关的几种，均为纯 JSON，便于 SSE 传输与跨模块透传。
export type AguiEvent =
  | { type: 'run_started'; runId?: string; threadId?: string }
  | { type: 'run_finished'; runId?: string; threadId?: string }
  | { type: 'run_error'; message?: string }
  | { type: 'text_message_start'; messageId: string; role?: string }
  | { type: 'text_message_content'; messageId: string; delta: string }
  | { type: 'text_message_end'; messageId: string }
  | { type: 'tool_call_start'; toolCallId: string; toolName?: string }
  | { type: 'tool_call_args'; toolCallId: string; delta: string }
  | { type: 'tool_call_end'; toolCallId: string }
  | { type: 'state_snapshot'; snapshot: Record<string, unknown> }
  | { type: 'state_delta'; delta: Record<string, unknown> }
  // 交互回写：微前端 widget 内的点击 / 输入经同一 aguiBus 单例回传给基座
  | {
      type: 'widget_action';
      app: string;
      value: string;
      slotId: string;
      label?: string;
    };

// 供事件总线做类型化分发（把所有 union 成员的 type 映射为其完整对象）
export type AguiEventMap = {
  [E in AguiEvent as E['type']]: E;
};

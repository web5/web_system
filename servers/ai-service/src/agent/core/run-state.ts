// 一次运行的会话状态
// 骨架占位：实现待方案确认后填充

export interface RunState {
  runId: string;
  step: number;
  messages: Array<{ role: string; content: string; toolCallId?: string }>;
}

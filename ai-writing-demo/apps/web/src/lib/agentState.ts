import { ref } from 'vue'

// 状态枚举 + reducer（对应你简历真实经验 §2，事件源扩到人机双方）
export enum AgentState {
  Idle = 'IDLE',
  Generating = 'GENERATING',
  AcceptPending = 'ACCEPT_PENDING',
  HumanEditing = 'HUMAN_EDITING',
  Reconcile = 'RECONCILE',
  Conflict = 'CONFLICT',
  NeedConfirm = 'NEED_CONFIRM',
}

export type AgentEvent =
  | { type: 'AI_SUBMIT' }
  | { type: 'ACCEPT' }
  | { type: 'REJECT' }
  | { type: 'HUMAN_EDIT' }
  | { type: 'CONTINUE' }
  | { type: 'CONFLICT_DETECTED' }
  | { type: 'NEED_CONFIRM' }

export function reducer(s: AgentState, e: AgentEvent): AgentState {
  switch (s) {
    case AgentState.Idle:
      return e.type === 'AI_SUBMIT' ? AgentState.Generating : s
    case AgentState.Generating:
      if (e.type === 'ACCEPT') return AgentState.AcceptPending
      if (e.type === 'REJECT') return AgentState.Idle
      if (e.type === 'HUMAN_EDIT') return AgentState.HumanEditing
      return s
    case AgentState.HumanEditing:
      return e.type === 'CONTINUE' ? AgentState.Reconcile : s
    case AgentState.Reconcile:
      return e.type === 'CONFLICT_DETECTED' ? AgentState.Conflict : s
    case AgentState.Conflict:
      if (e.type === 'NEED_CONFIRM') return AgentState.NeedConfirm
      if (e.type === 'ACCEPT') return AgentState.AcceptPending
      return s
    default:
      return s
  }
}

export function useAgentState() {
  const state = ref<AgentState>(AgentState.Idle)
  const dispatch = (e: AgentEvent) => {
    state.value = reducer(state.value, e)
  }
  return { state, dispatch }
}

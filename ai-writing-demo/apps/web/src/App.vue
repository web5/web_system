<script setup lang="ts">
import { ref } from 'vue'
import { createDoc } from './lib/useYDoc'
import { createProvider } from './lib/useProvider'
import { useAgentState, AgentState } from './lib/agentState'
import { useEditLog, useAuditLog } from './lib/collab'
import { useChat } from './lib/useChat'
import { randomUser } from './config'
import ChatPanel from './components/ChatPanel.vue'
import DocPanel from './components/DocPanel.vue'

const docId = 'demo-doc'
const user = randomUser()
const { ydoc } = createDoc(docId)
const provider = createProvider(docId, ydoc)

const agentState = useAgentState()
const { recordHumanEdit, humanEditsSince, getLastAiSeq } = useEditLog()
const audit = useAuditLog()

// 文档面板是主干唯一真源：读文本 / 整体写入 / 撤销重做都经它
const docRef = ref<any>(null)
const getDocText = (): string => docRef.value?.getText() ?? ''
const setDocText = (t: string) => docRef.value?.setText(t)

const overlapWarning = ref(false)

const { messages, busy, send, undoChange } = useChat({
  getDocText,
  setDocText,
  beforeSend: () => {
    agentState.dispatch({ type: 'AI_SUBMIT' })
    audit.record({ actor: 'ai-agent', action: 'submit' })
  },
  afterApply: (overlapped: boolean) => {
    if (overlapped) {
      agentState.dispatch({ type: 'CONFLICT_DETECTED' })
      overlapWarning.value = true
      audit.record({ actor: 'ai-agent', action: 'apply(交叉)' })
    } else {
      audit.record({ actor: 'ai-agent', action: 'apply' })
    }
  },
})

// 主干被人类编辑（本地/远端）→ 编辑日志 + 状态机 + 审计
const onHumanUpdate = () => {
  recordHumanEdit(getDocText())
  agentState.dispatch({ type: 'HUMAN_EDIT' })
  audit.record({ actor: 'human', action: 'edit' })
  overlapWarning.value = false
}

const onSend = (t: string) => send(t)
const onUndoChange = (id: string) => {
  undoChange(id)
  audit.record({ actor: 'human', action: 'undo-ai' })
}
const stateLabel = (s: AgentState) => s
</script>

<template>
  <div class="page">
    <header>
      <h1>AI 协作写作 Demo</h1>
      <p class="sub">
        左侧对话 · 右侧文档 ｜ docId：{{ docId }} ｜ 身份：{{ user.name }}
        <span :style="{ color: user.color }">●</span> ｜ 状态机：<b>{{ stateLabel(agentState.state.value) }}</b>
      </p>
    </header>

    <section class="grid">
      <ChatPanel :messages="messages" :busy="busy" @send="onSend" @undo="onUndoChange" />
      <DocPanel
        ref="docRef"
        :ydoc="ydoc"
        :provider="provider"
        :user="user"
        :doc-id="docId"
        :human-edit-count="humanEditsSince(getLastAiSeq()).length"
        :agent-state-label="stateLabel(agentState.state.value)"
        :overlap-warning="overlapWarning"
        @human-update="onHumanUpdate"
      />
    </section>

    <section class="log">
      <h3>变更记录（可溯源）</h3>
      <ul>
        <li v-for="(e, i) in audit.events.value" :key="i">
          [{{ new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false }) }}] {{ e.actor }} · {{ e.action }}
        </li>
      </ul>
    </section>
  </div>
</template>

<style>
body { margin: 0; background: #0A0A0D; color: #f5f5f5; font-family: system-ui, -apple-system, 'PingFang SC', sans-serif; }
.page { max-width: 1240px; margin: 0 auto; padding: 18px; }
header h1 { margin: 0 0 4px; font-size: 19px; }
.sub { margin: 2px 0 12px; color: #9aa; font-size: 12.5px; }
.grid { display: grid; grid-template-columns: minmax(340px, 1fr) minmax(420px, 1.2fr); gap: 16px; height: 620px; }
.log { margin-top: 14px; background: #15151a; border: 1px solid #2a2a30; border-radius: 10px; padding: 10px 12px; }
.log h3 { margin: 0; font-size: 13px; }
.log ul { margin: 6px 0 0; padding-left: 18px; font-size: 11.5px; color: #9aa; max-height: 90px; overflow-y: auto; }
</style>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '../lib/useChat'

const props = defineProps<{ messages: ChatMessage[]; busy: boolean }>()
const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'undo', changeId: string): void
}>()

const draft = ref('')
const listRef = ref<HTMLElement | null>(null)

const submit = () => {
  const t = draft.value.trim()
  if (!t || props.busy) return
  emit('send', t)
  draft.value = ''
}

const quick = (t: string) => {
  draft.value = t
}

// 让消息列表随流式输出自动滚到底
watch(
  () => props.messages.map((m) => `${m.role}:${m.text.length}`).join('|'),
  async () => {
    await nextTick()
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
  },
)
</script>

<template>
  <div class="chat">
    <div class="chat-head">
      <h3>对话</h3>
      <span class="hint">发指令 → AI 直接写进右侧文档</span>
    </div>

    <div class="msgs" ref="listRef">
      <div v-if="!messages.length" class="empty">
        试试：<br />
        <button class="chip" @click="quick('帮我写一篇项目周报')">帮我写一篇项目周报</button>
        <button class="chip" @click="quick('把第一段改得更正式')">把第一段改得更正式</button>
        <button class="chip" @click="quick('给文档补一个风险与求助小节')">补一个风险小节</button>
      </div>

      <div
        v-for="m in messages"
        :key="m.id"
        class="msg"
        :class="m.role === 'user' ? 'me' : 'ai'"
      >
        <div class="bubble">
          <div class="who">{{ m.role === 'user' ? '我' : 'AI' }}</div>
          <div class="text">{{ m.text }}<span v-if="m.streaming" class="caret"></span></div>

          <div v-if="m.applied" class="applied">
            <span v-if="m.applied.undone" class="tag undone">已撤销本次改动</span>
            <template v-else>
              <span class="tag ok">已写入文档 · 改动 {{ m.applied.changedCount }} 段</span>
              <span v-if="m.applied.overlapped" class="tag warn">⚠️ 与你的修改交叉</span>
              <button class="undo" @click="emit('undo', m.applied.changeId)">撤销本次改动</button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div class="compose">
      <textarea
        v-model="draft"
        placeholder="输入指令，Enter 发送 / Shift+Enter 换行"
        @keydown.enter.exact.prevent="submit"
      />
      <button class="primary" :disabled="busy || !draft.trim()" @click="submit">
        {{ busy ? '生成中…' : '发送' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat { display: flex; flex-direction: column; height: 100%; background: #15151a; border: 1px solid #2a2a30; border-radius: 10px; padding: 12px; }
.chat-head { display: flex; align-items: baseline; gap: 8px; }
.chat-head h3 { margin: 0; font-size: 15px; }
.hint { color: #9aa; font-size: 12px; }
.msgs { flex: 1; overflow-y: auto; margin: 10px 0; padding-right: 4px; }
.empty { color: #8a8a95; font-size: 13px; line-height: 2; }
.chip { background: #23232b; border: 1px solid #333; color: #ddd; border-radius: 999px; padding: 4px 10px; margin-right: 6px; cursor: pointer; font-size: 12px; }
.chip:hover { border-color: #F97316; color: #F97316; }
.msg { display: flex; margin-bottom: 12px; }
.msg.me { justify-content: flex-end; }
.bubble { max-width: 88%; background: #1b1b22; border: 1px solid #2a2a30; border-radius: 10px; padding: 8px 10px; }
.msg.me .bubble { background: #2a1d10; border-color: #5a3a1a; }
.who { font-size: 11px; color: #9aa; margin-bottom: 4px; }
.text { font-size: 13.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.caret { display: inline-block; width: 7px; height: 14px; background: #F97316; margin-left: 3px; vertical-align: -2px; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0 } }
.applied { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tag { font-size: 11px; border-radius: 4px; padding: 2px 6px; }
.tag.ok { background: #12351f; color: #7ee2a8; }
.tag.warn { background: #4a2a08; color: #ffc078; }
.tag.undone { background: #333; color: #bbb; }
.undo { background: #23232b; border: 1px solid #444; color: #ddd; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.undo:hover { border-color: #F97316; color: #F97316; }
.compose { display: flex; gap: 8px; align-items: flex-end; }
.compose textarea { flex: 1; height: 68px; resize: none; background: #101015; border: 1px solid #2a2a30; color: #f5f5f5; border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: inherit; }
.compose textarea:focus { outline: none; border-color: #F97316; }
button.primary { background: #F97316; border-color: #F97316; color: #111; border-radius: 8px; padding: 8px 16px; cursor: pointer; font-weight: 600; }
button.primary:disabled { opacity: 0.45; cursor: not-allowed; }
</style>

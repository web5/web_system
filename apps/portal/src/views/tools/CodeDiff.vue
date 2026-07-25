<template>
  <div class="tool-page">
    <div class="tool-container">
      <div class="tool-header">
        <router-link to="/tools" class="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          返回工具箱
        </router-link>
        <h1 class="tool-title">代码对比</h1>
        <p class="tool-desc">对比两段文本/代码的差异，高亮显示增删改</p>
      </div>

      <div class="diff-container">
        <!-- 左侧输入 -->
        <div class="editor-panel">
          <div class="panel-header">
            <span class="panel-label">旧版本 (Base)</span>
            <div class="panel-actions">
              <button class="action-btn" @click="clearOld">清空</button>
              <button class="action-btn" @click="pasteOld">粘贴</button>
            </div>
          </div>
          <textarea
            v-model="oldText"
            class="code-input"
            placeholder="旧版本代码..."
            spellcheck="false"
          ></textarea>
        </div>

        <!-- 右侧输入 -->
        <div class="editor-panel">
          <div class="panel-header">
            <span class="panel-label">新版本 (Changed)</span>
            <div class="panel-actions">
              <button class="action-btn" @click="clearNew">清空</button>
              <button class="action-btn" @click="pasteNew">粘贴</button>
            </div>
          </div>
          <textarea
            v-model="newText"
            class="code-input"
            placeholder="新版本代码..."
            spellcheck="false"
          ></textarea>
        </div>
      </div>

      <div class="tool-actions">
        <button class="tool-btn primary" @click="computeDiff">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="4" y1="7" x2="9" y2="12"/><line x1="4" y1="12" x2="9" y2="12"/></svg>
          对比差异
        </button>
        <button class="tool-btn" @click="swapTexts">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
          交换对比
        </button>
        <button class="tool-btn" @click="clearAll">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          清空
        </button>
      </div>

      <!-- 差异结果 -->
      <div v-if="diffResult.length > 0" class="diff-result">
        <div class="result-header">
          <span class="result-label">差异结果</span>
          <div class="result-stats">
            <span class="stat addition">+{{ stats.additions }}</span>
            <span class="stat deletion">-{{ stats.deletions }}</span>
            <span class="stat unchanged">{{ stats.unchanged }} 行不变</span>
          </div>
        </div>
        <div class="diff-output">
          <div
            v-for="(line, idx) in diffResult"
            :key="idx"
            class="diff-line"
            :class="line.type"
          >
            <span class="line-num">{{ idx + 1 }}</span>
            <span class="line-marker">{{ line.marker }}</span>
            <span class="line-content">{{ line.content }}</span>
          </div>
        </div>
      </div>

      <div v-if="error" class="tool-error">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {{ error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { diffLines, type Change } from 'diff';

const oldText = ref('');
const newText = ref('');
const error = ref('');
const diffResult = ref<Array<{ type: string; marker: string; content: string }>>([]);

const stats = reactive({
  additions: 0,
  deletions: 0,
  unchanged: 0,
});

function clearOld() { oldText.value = ''; }
function clearNew() { newText.value = ''; }
function clearAll() {
  oldText.value = '';
  newText.value = '';
  diffResult.value = [];
  stats.additions = 0;
  stats.deletions = 0;
  stats.unchanged = 0;
  error.value = '';
}

async function pasteOld() {
  try { oldText.value = await navigator.clipboard.readText(); }
  catch { error.value = '无法读取剪贴板'; }
}

async function pasteNew() {
  try { newText.value = await navigator.clipboard.readText(); }
  catch { error.value = '无法读取剪贴板'; }
}

function swapTexts() {
  const tmp = oldText.value;
  oldText.value = newText.value;
  newText.value = tmp;
  if (diffResult.value.length > 0) computeDiff();
}

function computeDiff() {
  error.value = '';
  diffResult.value = [];
  stats.additions = 0;
  stats.deletions = 0;
  stats.unchanged = 0;

  if (!oldText.value.trim() && !newText.value.trim()) {
    error.value = '请至少输入一段文本';
    return;
  }

  const changes: Change[] = diffLines(oldText.value, newText.value);
  const lines: Array<{ type: string; marker: string; content: string }> = [];

  for (const change of changes) {
    const valueLines = change.value.split('\n');
    // 最后一项往往是空字符串（结尾换行符分割出来的），忽略
    const contentLines = valueLines[valueLines.length - 1] === ''
      ? valueLines.slice(0, -1)
      : valueLines;

    if (change.added) {
      for (const line of contentLines) {
        lines.push({ type: 'addition', marker: '+', content: line });
        stats.additions++;
      }
    } else if (change.removed) {
      for (const line of contentLines) {
        lines.push({ type: 'deletion', marker: '-', content: line });
        stats.deletions++;
      }
    } else {
      for (const line of contentLines) {
        lines.push({ type: 'unchanged', marker: ' ', content: line });
        stats.unchanged++;
      }
    }
  }

  diffResult.value = lines;
}
</script>

<style scoped>
.tool-page {
  min-height: calc(100vh - 64px);
  background: linear-gradient(180deg, #FFFBF5 0%, #F6F8FC 100%);
  padding: 2rem 1.5rem 4rem;
}

.tool-container {
  max-width: 1100px;
  margin: 0 auto;
}

.tool-header {
  margin-bottom: 2rem;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #888;
  font-size: 13px;
  text-decoration: none;
  margin-bottom: 12px;
  transition: color 0.2s;
}

.back-link:hover { color: #8884FF; }

.tool-title {
  font-size: 1.8rem;
  font-weight: 700;
  color: #333;
  margin: 0 0 6px;
}

.tool-desc {
  font-size: 14px;
  color: #888;
  margin: 0;
}

.diff-container {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.editor-panel {
  background: #fff;
  border-radius: 16px;
  border: 1px solid #f1f5f9;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #fafbfc;
  border-bottom: 1px solid #f1f5f9;
}

.panel-label {
  font-size: 13px;
  font-weight: 600;
  color: #555;
}

.panel-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover {
  background: #8884FF;
  color: #fff;
  border-color: #8884FF;
}

.code-input {
  width: 100%;
  min-height: 180px;
  padding: 16px;
  border: none;
  outline: none;
  resize: vertical;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.6;
  color: #333;
  background: #fff;
}

.code-input:focus {
  background: #f5f3ff;
}

.tool-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin-bottom: 16px;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 24px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  color: #555;
  background: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.tool-btn:hover {
  border-color: #8884FF;
  color: #8884FF;
  background: #f5f3ff;
}

.tool-btn.primary {
  background: #8884FF;
  color: #fff;
  border-color: #8884FF;
  box-shadow: 0 4px 12px rgba(136, 132, 255, 0.3);
}

.tool-btn.primary:hover {
  background: #7c78f0;
  border-color: #7c78f0;
  transform: translateY(-1px);
}

/* 差异结果 */
.diff-result {
  background: #fff;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.04);
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fafbfc;
  border-bottom: 1px solid #f1f5f9;
}

.result-label {
  font-size: 13px;
  font-weight: 600;
  color: #555;
}

.result-stats {
  display: flex;
  gap: 12px;
  align-items: center;
}

.stat {
  font-size: 12px;
  font-weight: 600;
}

.stat.addition { color: #16A34A; }
.stat.deletion { color: #DC2626; }
.stat.unchanged { color: #999; }

.diff-output {
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 13px;
  line-height: 1.6;
  max-height: 500px;
  overflow-y: auto;
}

.diff-line {
  display: flex;
  align-items: stretch;
  min-height: 22px;
}

.line-num {
  width: 40px;
  min-width: 40px;
  text-align: right;
  padding: 0 8px;
  color: #ccc;
  font-size: 11px;
  user-select: none;
  background: #fafbfc;
  border-right: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.line-marker {
  width: 24px;
  min-width: 24px;
  text-align: center;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.line-content {
  flex: 1;
  padding: 0 12px 0 8px;
  white-space: pre-wrap;
  word-break: break-all;
  display: flex;
  align-items: center;
}

.diff-line.addition {
  background: #F0FDF4;
}

.diff-line.addition .line-marker {
  color: #16A34A;
}

.diff-line.addition .line-content {
  color: #166534;
}

.diff-line.deletion {
  background: #FEF2F2;
}

.diff-line.deletion .line-marker {
  color: #DC2626;
}

.diff-line.deletion .line-content {
  color: #991B1B;
}

.diff-line.unchanged .line-marker {
  color: #ccc;
}

.diff-line.unchanged .line-content {
  color: #555;
}

.tool-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #FEF2F2;
  border: 1px solid #FECACA;
  border-radius: 10px;
  color: #DC2626;
  font-size: 13px;
  margin-top: 12px;
}

@media (max-width: 768px) {
  .diff-container {
    grid-template-columns: 1fr;
  }

  .tool-page { padding: 1.5rem 1rem 3rem; }
  .tool-title { font-size: 1.4rem; }
  .code-input { min-height: 120px; }
}
</style>

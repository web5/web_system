<template>
  <div class="tool-page">
    <div class="tool-container">
      <div class="tool-header">
        <router-link to="/tools" class="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          返回工具箱
        </router-link>
        <h1 class="tool-title">SQL 美化</h1>
        <p class="tool-desc">格式化、美化 SQL 查询语句，支持多种 SQL 方言</p>
      </div>

      <div class="tool-editor">
        <!-- 配置栏 -->
        <div class="config-bar">
          <div class="config-item">
            <label class="config-label">SQL 方言</label>
            <select v-model="dialect" class="config-select">
              <option value="sql">Standard SQL</option>
              <option value="mysql">MySQL</option>
              <option value="postgresql">PostgreSQL</option>
              <option value="sqlite">SQLite</option>
            </select>
          </div>
          <div class="config-item">
            <label class="config-label">缩进</label>
            <select v-model="indentStyle" class="config-select">
              <option value="  ">2 空格</option>
              <option value="    ">4 空格</option>
              <option value="\t">Tab</option>
            </select>
          </div>
        </div>

        <div class="editor-panel">
          <div class="panel-header">
            <span class="panel-label">输入</span>
            <div class="panel-actions">
              <button class="action-btn" @click="clearInput">清空</button>
              <button class="action-btn" @click="pasteInput">粘贴</button>
            </div>
          </div>
          <textarea
            v-model="input"
            class="code-input"
            placeholder="在此粘贴 SQL 语句..."
            spellcheck="false"
          ></textarea>
        </div>

        <div class="tool-actions">
          <button class="tool-btn primary" @click="formatSQL">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 15 15 20 20 10"/><path d="M4 4h7v7"/></svg>
            美化
          </button>
          <button class="tool-btn" @click="minifySQL">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            压缩
          </button>
        </div>

        <div class="editor-panel">
          <div class="panel-header">
            <span class="panel-label">输出</span>
            <div class="panel-actions">
              <button class="action-btn" @click="copyOutput">复制</button>
              <button class="action-btn" @click="downloadOutput">下载</button>
            </div>
          </div>
          <textarea
            v-model="output"
            class="code-input output-input"
            placeholder="美化后的 SQL 将显示在这里..."
            readonly
            spellcheck="false"
          ></textarea>
        </div>
      </div>

      <div v-if="error" class="tool-error">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {{ error }}
      </div>

      <div v-if="successMsg" class="tool-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        {{ successMsg }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { format, dialect as sqlDialects } from 'sql-formatter';

const input = ref('');
const output = ref('');
const dialect = ref('mysql');
const indentStyle = ref('  ');
const error = ref('');
const successMsg = ref('');

let successTimer: ReturnType<typeof setTimeout>;

function showSuccess(msg: string) {
  successMsg.value = msg;
  clearTimeout(successTimer);
  successTimer = setTimeout(() => { successMsg.value = ''; }, 2500);
}

function clearInput() {
  input.value = '';
  output.value = '';
  error.value = '';
}

async function pasteInput() {
  try {
    input.value = await navigator.clipboard.readText();
  } catch {
    error.value = '无法读取剪贴板，请手动粘贴';
  }
}

function formatSQL() {
  error.value = '';
  output.value = '';
  if (!input.value.trim()) {
    error.value = '请输入 SQL 语句';
    return;
  }
  try {
    output.value = format(input.value, {
      language: dialect.value as any,
      indent: indentStyle.value,
    });
    showSuccess('美化成功 ✓');
  } catch (e: any) {
    error.value = `SQL 格式化错误: ${e.message}`;
  }
}

function minifySQL() {
  error.value = '';
  output.value = '';
  if (!input.value.trim()) {
    error.value = '请输入 SQL 语句';
    return;
  }
  try {
    // 先格式化再移除多余空白行
    const formatted = format(input.value, {
      language: dialect.value as any,
      indent: indentStyle.value,
    });
    output.value = formatted
      .split('\n')
      .map(l => l.trim())
      .filter(l => l)
      .join(' ');
    showSuccess('压缩成功 ✓');
  } catch (e: any) {
    error.value = `SQL 压缩错误: ${e.message}`;
  }
}

async function copyOutput() {
  if (!output.value) { error.value = '没有输出内容可复制'; return; }
  try {
    await navigator.clipboard.writeText(output.value);
    showSuccess('已复制到剪贴板 ✓');
  } catch {
    error.value = '复制失败，请手动选择复制';
  }
}

function downloadOutput() {
  if (!output.value) { error.value = '没有输出内容可下载'; return; }
  const blob = new Blob([output.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'formatted.sql';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<style scoped>
.tool-page {
  min-height: calc(100vh - 64px);
  background: linear-gradient(180deg, #FFFBF5 0%, #F6F8FC 100%);
  padding: 2rem 1.5rem 4rem;
}

.tool-container {
  max-width: 1000px;
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

.back-link:hover { color: #4ECDC4; }

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

/* 配置栏 */
.config-bar {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.config-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-label {
  font-size: 13px;
  font-weight: 500;
  color: #666;
}

.config-select {
  padding: 6px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  color: #333;
  background: #fff;
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s;
}

.config-select:focus {
  border-color: #4ECDC4;
}

.tool-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  background: #4ECDC4;
  color: #fff;
  border-color: #4ECDC4;
}

.code-input {
  width: 100%;
  min-height: 200px;
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
  background: #f6fffe;
}

.output-input {
  background: #fafbfc !important;
  color: #555;
}

.tool-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
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
  border-color: #4ECDC4;
  color: #4ECDC4;
  background: #f0fdfa;
}

.tool-btn.primary {
  background: #4ECDC4;
  color: #fff;
  border-color: #4ECDC4;
  box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3);
}

.tool-btn.primary:hover {
  background: #3dbdb5;
  border-color: #3dbdb5;
  transform: translateY(-1px);
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

.tool-success {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #F0FDF4;
  border: 1px solid #BBF7D0;
  border-radius: 10px;
  color: #16A34A;
  font-size: 13px;
  margin-top: 12px;
}

@media (max-width: 640px) {
  .tool-page { padding: 1.5rem 1rem 3rem; }
  .tool-title { font-size: 1.4rem; }
  .code-input { min-height: 150px; }
  .tool-actions { flex-wrap: wrap; }
}
</style>

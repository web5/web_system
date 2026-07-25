<template>
  <div class="tool-page">
    <div class="tool-container">
      <!-- 头部 -->
      <div class="tool-header">
        <router-link to="/tools" class="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          返回工具箱
        </router-link>
        <h1 class="tool-title">JSON 格式化</h1>
        <p class="tool-desc">格式化、校验和压缩 JSON 数据</p>
      </div>

      <!-- 编辑器区 -->
      <div class="tool-editor">
        <div class="editor-panel">
          <div class="panel-header">
            <span class="panel-label">输入</span>
            <div class="panel-actions">
              <button class="action-btn" @click="clearInput">清空</button>
              <button class="action-btn" @click="pasteInput">粘贴</button>
              <label class="action-btn file-btn">
                上传文件
                <input type="file" accept=".json,application/json" @change="handleFileUpload" hidden>
              </label>
            </div>
          </div>
          <textarea
            v-model="input"
            class="code-input"
            placeholder="在此粘贴 JSON 数据..."
            spellcheck="false"
          ></textarea>
        </div>

        <!-- 操作按钮 -->
        <div class="tool-actions">
          <button class="tool-btn primary" @click="formatJSON">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 15 15 20 20 10"/><path d="M4 4h7v7"/></svg>
            格式化
          </button>
          <button class="tool-btn" @click="compressJSON">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            压缩
          </button>
          <button class="tool-btn" @click="validateJSON">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            校验
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
            placeholder="格式化后的 JSON 将显示在这里..."
            readonly
            spellcheck="false"
          ></textarea>
        </div>
      </div>

      <!-- 错误提示 -->
      <div v-if="error" class="tool-error">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {{ error }}
      </div>

      <!-- 成功提示 -->
      <div v-if="successMsg" class="tool-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        {{ successMsg }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const input = ref('');
const output = ref('');
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

function handleFileUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    input.value = reader.result as string;
  };
  reader.readAsText(file);
}

function formatJSON() {
  error.value = '';
  output.value = '';
  if (!input.value.trim()) {
    error.value = '请输入 JSON 数据';
    return;
  }
  try {
    const parsed = JSON.parse(input.value);
    output.value = JSON.stringify(parsed, null, 2);
    showSuccess('格式化成功 ✓');
  } catch (e: any) {
    error.value = `JSON 解析错误: ${e.message}`;
  }
}

function compressJSON() {
  error.value = '';
  output.value = '';
  if (!input.value.trim()) {
    error.value = '请输入 JSON 数据';
    return;
  }
  try {
    const parsed = JSON.parse(input.value);
    output.value = JSON.stringify(parsed);
    showSuccess('压缩成功 ✓');
  } catch (e: any) {
    error.value = `JSON 解析错误: ${e.message}`;
  }
}

function validateJSON() {
  error.value = '';
  output.value = '';
  if (!input.value.trim()) {
    error.value = '请输入 JSON 数据';
    return;
  }
  try {
    JSON.parse(input.value);
    showSuccess('JSON 格式有效 ✓');
  } catch (e: any) {
    error.value = `JSON 格式无效: ${e.message}`;
  }
}

async function copyOutput() {
  if (!output.value) {
    error.value = '没有输出内容可复制';
    return;
  }
  try {
    await navigator.clipboard.writeText(output.value);
    showSuccess('已复制到剪贴板 ✓');
  } catch {
    error.value = '复制失败，请手动选择复制';
  }
}

function downloadOutput() {
  if (!output.value) {
    error.value = '没有输出内容可下载';
    return;
  }
  const blob = new Blob([output.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'formatted.json';
  a.click();
  URL.revokeObjectURL(url);
}

watch(input, () => { error.value = ''; });
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

.back-link:hover { color: #FF8C42; }

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

/* 编辑器 */
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
  background: #FF8C42;
  color: #fff;
  border-color: #FF8C42;
}

.file-btn {
  cursor: pointer;
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
  background: #fefcf9;
}

.output-input {
  background: #fafbfc !important;
  color: #555;
}

/* 操作按钮 */
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
  border-color: #FF8C42;
  color: #FF8C42;
  background: #FFF8F0;
}

.tool-btn.primary {
  background: #FF8C42;
  color: #fff;
  border-color: #FF8C42;
  box-shadow: 0 4px 12px rgba(255, 140, 66, 0.25);
}

.tool-btn.primary:hover {
  background: #e67e2a;
  border-color: #e67e2a;
  transform: translateY(-1px);
}

/* 错误提示 */
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

/* 成功提示 */
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

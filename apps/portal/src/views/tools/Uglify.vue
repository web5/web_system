<template>
  <div class="tool-page">
    <div class="tool-container">
      <div class="tool-header">
        <router-link to="/tools" class="back-link">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          返回工具箱
        </router-link>
        <h1 class="tool-title">代码压缩</h1>
        <p class="tool-desc">压缩 JavaScript 代码，减小文件体积（基于 Terser）</p>
      </div>

      <div class="tool-editor">
        <!-- 配置栏 -->
        <div class="config-bar">
          <label class="config-checkbox">
            <input type="checkbox" v-model="options.mangle" />
            <span class="checkbox-label">变量名缩短 (Mangle)</span>
          </label>
          <label class="config-checkbox">
            <input type="checkbox" v-model="options.compress" />
            <span class="checkbox-label">代码压缩 (Compress)</span>
          </label>
          <label class="config-checkbox">
            <input type="checkbox" v-model="options.comments" />
            <span class="checkbox-label">保留注释</span>
          </label>
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
            placeholder="在此粘贴 JavaScript 代码..."
            spellcheck="false"
          ></textarea>
        </div>

        <div class="tool-actions">
          <button class="tool-btn primary" @click="minifyCode" :disabled="minifying">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><path d="M6 6h.01M6 18h.01"/></svg>
            {{ minifying ? '压缩中...' : '压缩' }}
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
            placeholder="压缩后的代码将显示在这里..."
            readonly
            spellcheck="false"
          ></textarea>
        </div>
      </div>

      <!-- 文件大小对比 -->
      <div v-if="stats.show" class="stats-bar">
        <div class="stat-item">
          <span class="stat-label">原始大小</span>
          <span class="stat-value">{{ stats.original }}</span>
        </div>
        <svg class="stat-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#888" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        <div class="stat-item">
          <span class="stat-label">压缩后</span>
          <span class="stat-value compressed">{{ stats.compressed }}</span>
        </div>
        <div class="stat-item saved">
          <span class="stat-label">节省</span>
          <span class="stat-value">{{ stats.saved }}</span>
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
import { ref, reactive } from 'vue';
import { minify } from 'terser';

const input = ref('');
const output = ref('');
const error = ref('');
const successMsg = ref('');
const minifying = ref(false);

const options = reactive({
  mangle: true,
  compress: true,
  comments: false,
});

const stats = reactive({
  show: false,
  original: '0 B',
  compressed: '0 B',
  saved: '0%',
});

let successTimer: ReturnType<typeof setTimeout>;

function showSuccess(msg: string) {
  successMsg.value = msg;
  clearTimeout(successTimer);
  successTimer = setTimeout(() => { successMsg.value = ''; }, 2500);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function clearInput() {
  input.value = '';
  output.value = '';
  error.value = '';
  stats.show = false;
}

async function pasteInput() {
  try {
    input.value = await navigator.clipboard.readText();
  } catch {
    error.value = '无法读取剪贴板，请手动粘贴';
  }
}

async function minifyCode() {
  error.value = '';
  output.value = '';
  stats.show = false;

  if (!input.value.trim()) {
    error.value = '请输入 JavaScript 代码';
    return;
  }

  minifying.value = true;
  try {
    const terserOpts: any = {};
    if (options.compress) terserOpts.compress = { drop_console: false };
    else terserOpts.compress = false;

    if (options.mangle) terserOpts.mangle = { toplevel: true };
    else terserOpts.mangle = false;

    terserOpts.format = {
      comments: options.comments,
    };

    const result = await minify({ 'input.js': input.value }, terserOpts);

    if (result.error) {
      error.value = `压缩错误: ${result.error.message}`;
      return;
    }

    output.value = result.code || '';

    // 计算大小对比
    const originalBytes = new Blob([input.value]).size;
    const compressedBytes = new Blob([output.value]).size;
    const savedPercent = originalBytes > 0
      ? ((1 - compressedBytes / originalBytes) * 100).toFixed(1)
      : '0.0';

    stats.original = formatSize(originalBytes);
    stats.compressed = formatSize(compressedBytes);
    stats.saved = `${savedPercent}%`;
    stats.show = true;

    showSuccess('压缩成功 ✓');
  } catch (e: any) {
    error.value = `压缩错误: ${e.message || e}`;
  } finally {
    minifying.value = false;
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
  const blob = new Blob([output.value], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'minified.js';
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

.back-link:hover { color: #7ED957; }

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

.config-bar {
  display: flex;
  gap: 20px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.config-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #555;
}

.config-checkbox input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #7ED957;
  cursor: pointer;
}

.checkbox-label {
  font-weight: 500;
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
  background: #7ED957;
  color: #fff;
  border-color: #7ED957;
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
  background: #f5fff2;
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

.tool-btn:hover:not(:disabled) {
  border-color: #7ED957;
  color: #7ED957;
  background: #f0fdf4;
}

.tool-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.tool-btn.primary {
  background: #7ED957;
  color: #fff;
  border-color: #7ED957;
  box-shadow: 0 4px 12px rgba(126, 217, 87, 0.3);
}

.tool-btn.primary:hover:not(:disabled) {
  background: #6cc74a;
  border-color: #6cc74a;
  transform: translateY(-1px);
}

/* 统计栏 */
.stats-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 16px;
  padding: 14px 20px;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}

.stat-item {
  text-align: center;
}

.stat-label {
  display: block;
  font-size: 11px;
  color: #999;
  margin-bottom: 2px;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #333;
}

.stat-value.compressed {
  color: #7ED957;
}

.stat-arrow {
  color: #ccc;
}

.stat-item.saved .stat-value {
  color: #FF8C42;
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
}
</style>

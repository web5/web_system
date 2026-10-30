<template>
  <div class="sub">
    <div class="chead">
      <button type="button" class="btn-back" @click="router.push('/profile')">
        <app-icon name="left" />返回
      </button>
      <h1>记忆画像</h1>
      <span class="chead-sp"></span>
      <!-- 重新生成：文字按钮；摘要不可手改，只能重算。loading + 禁用防重复 -->
      <button type="button" class="lnk" :disabled="rebuilding" @click="rebuild">
        <app-icon name="refresh" />{{ rebuilding ? '生成中…' : '重新生成' }}
      </button>
    </div>

    <div class="tip">
      <app-icon name="spark" />AI 每次对话后，从你们的聊天里提炼关于你的稳定信息；每一条你都可以自己改或删
    </div>

    <!-- ===== 摘要卡（置顶，只读；独立 skeleton / empty / error，与明细互不阻塞） ===== -->
    <div class="sum-card">
      <div v-if="summaryLoading" class="skl">
        <div class="skl-ln" style="width: 24%"></div>
        <div class="skl-ln"></div>
        <div class="skl-ln" style="width: 64%"></div>
      </div>
      <div v-else-if="summaryError" class="blk">
        <p class="blk-t">画像加载失败</p>
        <button type="button" class="lnk" @click="loadSummary">重试</button>
      </div>
      <div v-else-if="!summary" class="blk">
        <app-icon name="spark" size="lg" />
        <p class="blk-t">还没有记忆画像</p>
        <p class="blk-d">和我说说你偏好什么，我就能记住</p>
      </div>
      <template v-else>
        <div class="sum-hd">
          <span class="sum-title">你的画像</span>
          <span v-if="showPending" class="tag-pend">待更新</span>
        </div>
        <!-- 摘要正文来自 LLM 提炼（半可信输入）：{{ }} 插值转义渲染，禁 v-html -->
        <div class="sum-body">{{ summary.summary }}</div>
        <div class="sum-meta">
          <span>条数 <span class="num">{{ summary.itemCount }}</span></span>
          <span class="dot">·</span>
          <span>更新时间 <span class="num">{{ formatTime(summary.updatedAt) }}</span></span>
          <template v-if="showPending">
            <span class="dot">·</span>
            <span class="pend-note">你改过记忆，画像将在下次对话后刷新</span>
          </template>
        </div>
      </template>
    </div>

    <!-- ===== 明细分组（编辑 + 删除；独立加载/失败态） ===== -->
    <div v-if="loading" class="skl card-box">
      <div class="skl-ln" style="width: 30%"></div>
      <div class="skl-ln" style="width: 86%"></div>
      <div class="skl-ln" style="width: 70%"></div>
    </div>
    <div v-else-if="listError" class="blk card-box">
      <p class="blk-t">记忆条目加载失败（与画像互不影响）</p>
      <button type="button" class="lnk" @click="load">重试</button>
    </div>
    <div v-else-if="items.length === 0" class="empty">
      <app-icon name="spark" size="lg" />
      <p>暂无记忆条目，去对话里多聊聊，AI 会慢慢认识你</p>
    </div>
    <div v-else class="groups">
      <div v-for="g in groups" :key="g.cat" class="group">
        <h3>{{ g.cat }} <em>{{ g.items.length }} 条</em></h3>
        <template v-for="m in g.items" :key="m.id">
          <!-- 行内编辑态（同一时刻只编辑一条） -->
          <div v-if="editing && editing.id === m.id" class="row editing">
            <textarea
              ref="editTa"
              v-model="editing.draft"
              class="edit-ta"
              :class="{ err: !!draftErr }"
              rows="3"
              :maxlength="MAX_EDIT_CHARS + 40"
              placeholder="说点什么，比如：我更喜欢安静的歌"
            ></textarea>
            <div class="edit-foot">
              <span class="counter" :class="{ over: draftLen > MAX_EDIT_CHARS }">{{ draftLen }}/{{ MAX_EDIT_CHARS }}</span>
              <span v-if="draftErr" class="edit-err">{{ draftErr }}</span>
              <span class="edit-foot-sp"></span>
              <button type="button" class="ebtn" :disabled="saving" @click="cancelEdit">取消</button>
              <button type="button" class="ebtn save" :disabled="saving || !!draftErr" @click="saveEdit">
                {{ saving ? '保存中…' : '保存' }}
              </button>
            </div>
          </div>
          <!-- 读态：hover 显形 编辑 + 删除（键盘可达：focus-within 同样显形） -->
          <div v-else class="row">
            <span class="txt">{{ m.content }}</span>
            <span class="row-acts">
              <button type="button" class="icon-act" title="编辑" aria-label="编辑" @click="startEdit(m)">
                <app-icon name="edit" />
              </button>
              <a-popconfirm
                title="确定删除这条记忆？"
                ok-text="删除"
                cancel-text="取消"
                @confirm="remove(m.id)"
              >
                <button type="button" class="icon-act del" title="删除" aria-label="删除">
                  <app-icon name="x" />
                </button>
              </a-popconfirm>
            </span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  listMemory,
  getMyMemorySummary,
  editMyMemory,
  rebuildMySummary,
  removeMemory,
  type MemoryItem,
  type MemorySummary,
} from '@/api/user-memory';
import AppIcon from '@/components/AppIcon.vue';

const router = useRouter();

/** 编辑长度上限（与后端 PATCH 校验同口径：trim 非空、≤500 字） */
const MAX_EDIT_CHARS = 500;

/* ===== 摘要卡状态 ===== */
const summary = ref<MemorySummary | null>(null);
const summaryLoading = ref(true);
const summaryError = ref(false);

/* ===== 明细状态 ===== */
const loading = ref(true);
const listError = ref(false);
const items = ref<MemoryItem[]>([]);
const CATS = ['事实', '偏好', '习惯'];
const groups = ref<Array<{ cat: string; items: MemoryItem[] }>>([]);

/* ===== 编辑 / 删除 / 待更新 ===== */
/** 本地「待更新」标记：编辑/删除成功后置 true（摘要由下次对话后重算） */
const pending = ref(false);
const rebuilding = ref(false);
const editing = ref<{ id: number; draft: string } | null>(null);
const saving = ref(false);

const draftLen = computed(() => (editing.value ? Array.from(editing.value.draft).length : 0));
/** 即时校验：空 → 「内容不能为空」；超 500 → 「最多 500 字，已超出 N 字」；不过则保存禁用 */
const draftErr = computed(() => {
  if (!editing.value) return '';
  const draft = editing.value.draft;
  if (!draft.trim()) return '内容不能为空';
  const len = Array.from(draft).length;
  if (len > MAX_EDIT_CHARS) return `最多 ${MAX_EDIT_CHARS} 字，已超出 ${len - MAX_EDIT_CHARS} 字`;
  return '';
});

/** 展示「待更新」：本地刚改/删过，或摘要覆盖条数与明细总数对不上（其它端改过） */
const showPending = computed(
  () => pending.value || (!!summary.value && Number(summary.value.itemCount) !== items.value.length),
);

async function loadSummary() {
  summaryLoading.value = true;
  summaryError.value = false;
  try {
    summary.value = await getMyMemorySummary();
  } catch {
    summaryError.value = true;
  } finally {
    summaryLoading.value = false;
  }
}

async function load() {
  loading.value = true;
  listError.value = false;
  try {
    const { list } = await listMemory(1, 50);
    items.value = list;
    groups.value = CATS.map((cat) => ({ cat, items: list.filter((m) => m.category === cat) })).filter(
      (g) => g.items.length > 0,
    );
  } catch {
    listError.value = true;
    items.value = [];
    groups.value = [];
  } finally {
    loading.value = false;
  }
}

/* ===== 行内编辑 ===== */
function startEdit(m: MemoryItem) {
  if (saving.value) return;
  editing.value = { id: m.id, draft: m.content };
  void nextTick(() => {
    const ta = (document.querySelectorAll('.edit-ta') as NodeListOf<HTMLTextAreaElement>)[0];
    if (ta) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  });
}

/** 取消不落改动：不发请求，直接丢弃草稿还原原文 */
function cancelEdit() {
  editing.value = null;
}

async function saveEdit() {
  const ed = editing.value;
  if (!ed || saving.value || draftErr.value) return;
  saving.value = true;
  try {
    const row = await editMyMemory(ed.id, ed.draft);
    const idx = items.value.findIndex((x) => x.id === ed.id);
    if (idx >= 0) {
      items.value[idx] = { ...items.value[idx], content: row?.content ?? ed.draft.trim() };
      groups.value = CATS.map((cat) => ({
        cat,
        items: items.value.filter((m) => m.category === cat),
      })).filter((g) => g.items.length > 0);
    }
    editing.value = null;
    pending.value = true; // 摘要由下次对话后重算，显式标「待更新」
    message.success('已保存，AI 下次对话后会使用新内容');
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 403) {
      // 越权 / 条目已删：明确报错并退出编辑态刷新列表
      message.error('无权修改该条记忆，可能已被删除');
      editing.value = null;
      void load();
    } else {
      const backendMsg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(backendMsg || '保存失败，请重试');
      // 保存失败：保留编辑态与已输入内容，用户可改后重试
    }
  } finally {
    saving.value = false;
  }
}

/* ===== 删除（二次确认在模板 a-popconfirm） ===== */
async function remove(id: number) {
  if (editing.value?.id === id) editing.value = null;
  const ok = await removeMemory(id);
  if (ok) {
    message.success('已删除该记忆');
    pending.value = true;
    void load();
  } else {
    message.error('删除失败，请重试');
  }
}

/* ===== 重新生成画像（摘要不可手改，只能重算） ===== */
async function rebuild() {
  if (rebuilding.value) return;
  rebuilding.value = true;
  try {
    await rebuildMySummary();
    pending.value = false;
    await loadSummary();
    message.success('已更新');
  } catch {
    // 失败已由 request 拦截器按后端 message 提示，这里只复位 loading
  } finally {
    rebuilding.value = false;
  }
}

function formatTime(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

onMounted(() => {
  void loadSummary();
  void load();
});
</script>

<style scoped>
.sub {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px 32px 24px;
}

.chead {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.chead h1 {
  font-size: 18px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.chead-sp {
  flex: 1;
}

.btn-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  border-radius: var(--ws-radius-md);
  font-size: 13px;
  color: var(--ws-text-secondary);
}

.btn-back:hover {
  background: var(--ws-bg-subtle);
}

.lnk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  padding: 0 4px;
  height: 28px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--ws-brand-700, #c2410c);
  cursor: pointer;
}

.lnk:hover {
  text-decoration: underline;
}

.lnk[disabled] {
  color: var(--ws-text-tertiary);
  cursor: not-allowed;
  text-decoration: none;
}

.tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin-bottom: 16px;
}

/* ===== 摘要卡（轻量卡片，只读） ===== */
.sum-card {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-lg);
  background: var(--ws-bg-surface);
  padding: 16px 18px;
  margin-bottom: 16px;
  max-width: 720px;
}

.sum-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.sum-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
}

.tag-pend {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--ws-radius-sm, 4px);
  font-size: 12px;
  background: var(--ws-brand-soft, #fff7ed);
  color: var(--ws-brand-700, #c2410c);
}

.sum-body {
  font-size: 13px;
  color: var(--ws-text-body, #3f3f46);
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
}

.sum-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
  font-size: 12px;
  color: var(--ws-text-secondary);
}

.sum-meta .dot {
  color: var(--ws-text-tertiary);
}

.sum-meta .num {
  font-variant-numeric: tabular-nums;
}

.pend-note {
  color: var(--ws-brand-700, #c2410c);
}

/* ===== 空态 / 失败态 / 骨架 ===== */
.card-box {
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-lg);
  background: var(--ws-bg-surface);
  padding: 24px 18px;
  max-width: 720px;
}

.blk {
  text-align: center;
}

.blk-t {
  font-size: 13px;
  color: var(--ws-text-secondary);
  margin: 8px 0 4px;
}

.blk-d {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin: 0 0 8px;
}

.skl-ln {
  height: 14px;
  border-radius: 6px;
  margin-bottom: 10px;
  background: linear-gradient(90deg, var(--ws-bg-subtle) 25%, var(--ws-bg-active, #ebebeb) 37%, var(--ws-bg-subtle) 63%);
  background-size: 400% 100%;
  animation: sk 1.2s ease infinite;
}

@keyframes sk {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 48px 0;
  color: var(--ws-text-tertiary);
  font-size: 13px;
}

/* ===== 明细分组 ===== */
.groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}

.group h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-primary);
  margin-bottom: 8px;
}

.group h3 em {
  font-style: normal;
  font-weight: 400;
  font-size: 12px;
  color: var(--ws-text-tertiary);
  margin-left: 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  background: var(--ws-bg-surface);
  margin-bottom: 8px;
}

.row:hover {
  border-color: var(--ws-border-subtle, var(--ws-border));
}

.row .txt {
  flex: 1;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ws-text-primary);
}

/* 行内操作：hover / 键盘 focus 显形（编辑 + 删除） */
.row-acts {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease-out;
}

.row:hover .row-acts,
.row-acts:focus-within {
  opacity: 1;
}

.icon-act {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--ws-radius-sm, 4px);
  background: none;
  color: var(--ws-text-tertiary);
  cursor: pointer;
  padding: 0;
}

.icon-act:hover {
  background: var(--ws-bg-subtle);
  color: var(--ws-brand-600, #ea580c);
}

.icon-act.del:hover {
  color: var(--ws-error-500, #e5484d);
}

/* ===== 行内编辑态 ===== */
.row.editing {
  display: block;
  border-color: var(--ws-brand-400, #fb923c);
  box-shadow: 0 0 0 3px var(--ws-brand-soft, #fff7ed);
}

.edit-ta {
  width: 100%;
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  padding: 9px 12px;
  font: inherit;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ws-text-primary);
  background: var(--ws-bg-surface);
  min-height: 64px;
  resize: vertical;
}

.edit-ta:focus {
  border-color: var(--ws-brand-400, #fb923c);
  outline: none;
}

.edit-ta::placeholder {
  color: var(--ws-text-disabled, #d4d4d4);
}

.edit-ta.err {
  border-color: var(--ws-error-500, #e5484d);
}

.edit-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.counter {
  font-size: 12px;
  color: var(--ws-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.counter.over {
  color: var(--ws-error-500, #e5484d);
}

.edit-err {
  font-size: 12px;
  color: var(--ws-error-500, #e5484d);
}

.edit-foot-sp {
  flex: 1;
}

.ebtn {
  height: 26px;
  padding: 0 12px;
  border-radius: var(--ws-radius-md);
  border: 1px solid var(--ws-border);
  background: var(--ws-bg-surface);
  font: inherit;
  font-size: 12px;
  color: var(--ws-text-primary);
  cursor: pointer;
}

.ebtn:hover {
  border-color: var(--ws-brand-400, #fb923c);
  color: var(--ws-brand-600, #ea580c);
}

.ebtn.save {
  background: var(--ws-brand-700, #c2410c);
  border-color: var(--ws-brand-700, #c2410c);
  color: #fff;
  font-weight: 500;
}

.ebtn.save:hover {
  color: #fff;
  opacity: 0.92;
}

.ebtn[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>

<script setup lang="ts">
/**
 * 公众号封面素材库。
 *
 * 解决的事：发布器此前只有「正文首图」和一张硬编码的通用封面可选，
 * 换图要改环境变量。这里把封面变成可管理的资产：上传或按标题生成 → 打标签 →
 * 同步微信永久素材 → 绑到管线当默认封面。
 *
 * 两个交互上的取舍：
 *  · 图片地址直接用后端返回的 `/api/uploads/...`（同源，经网关），不做二次拼域名；
 *  · AI 生成是同步接口（10~40s），按钮上必须显示"生成中 + 已用时"，
 *    否则用户会当成点了没反应，从而连点多次生成一堆图。
 */
import { computed, onMounted, ref } from 'vue';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import { moduleOverlayContainer } from '@/utils/mount';
import {
  deleteMedia,
  generateMediaCover,
  listMedia,
  listMediaTags,
  listPipelines,
  syncMediaToWechat,
  updateMedia,
  updatePipeline,
  uploadMedia,
  type ContentMedia,
  type ContentPipeline,
} from '@/api/content';

const userStore = useUserStore();
const canManage = userStore.hasPermission('content:manage');

const assets = ref<ContentMedia[]>([]);
const loading = ref(false);
const uploading = ref(false);

// ── 筛选 ──
const keyword = ref('');
const tag = ref<string | undefined>(undefined);
const source = ref<string | undefined>(undefined);
const tagOptions = ref<{ tag: string; count: number }[]>([]);

async function load() {
  loading.value = true;
  try {
    assets.value = await listMedia({
      keyword: keyword.value.trim() || undefined,
      tag: tag.value,
      source: source.value,
    });
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

async function loadTags() {
  try {
    tagOptions.value = await listMediaTags();
  } catch {
    /* 标签加载失败不影响主列表 */
  }
}

// ── 上传 ──
const fileInput = ref<HTMLInputElement | null>(null);

function pickFile() {
  fileInput.value?.click();
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // 允许连续选同一个文件重传
  if (!file) return;

  // 前端先挡一道（后端还会再挡）：格式/大小不对时不必等一个来回
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    message.error('只支持 JPG / PNG / WebP（动图上传到微信只剩首帧，所以不收 GIF）');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    message.error(`封面不能超过 5MB（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB）`);
    return;
  }

  uploading.value = true;
  try {
    const asset = await uploadMedia(file);
    message.success(`已上传：${asset.name ?? file.name}`);
    await Promise.all([load(), loadTags()]);
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    uploading.value = false;
  }
}

// ── AI 生成 ──
const genOpen = ref(false);
const genForm = ref({ title: '', summary: '', styleExtra: '' });
const generating = ref(false);
const genElapsed = ref(0);
let genTimer: ReturnType<typeof setInterval> | null = null;

function openGenerate() {
  genForm.value = { title: '', summary: '', styleExtra: '' };
  genOpen.value = true;
}

async function onGenerate() {
  const title = genForm.value.title.trim();
  if (!title) {
    message.warning('先填文章标题 —— 画面是按标题生成的');
    return;
  }
  generating.value = true;
  genElapsed.value = 0;
  // 生图 10~40s，必须让用户看见"在动"，否则一定会被当成卡死
  genTimer = setInterval(() => {
    genElapsed.value += 1;
  }, 1000);
  try {
    const asset = await generateMediaCover({
      title,
      summary: genForm.value.summary.trim() || undefined,
      styleExtra: genForm.value.styleExtra.trim() || undefined,
    });
    message.success(`已生成封面：${asset.name}`);
    genOpen.value = false;
    await Promise.all([load(), loadTags()]);
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    generating.value = false;
    if (genTimer) {
      clearInterval(genTimer);
      genTimer = null;
    }
  }
}

// ── 编辑 / 删除 / 同步 ──
const editOpen = ref(false);
const editForm = ref<{ id: number | null; name: string; tags: string[]; enabled: boolean }>({
  id: null,
  name: '',
  tags: [],
  enabled: true,
});

function openEdit(asset: ContentMedia) {
  editForm.value = {
    id: asset.id,
    name: asset.name ?? '',
    tags: [...asset.tags],
    enabled: asset.enabled,
  };
  editOpen.value = true;
}

async function saveEdit() {
  if (!editForm.value.id) return;
  try {
    await updateMedia(editForm.value.id, {
      name: editForm.value.name,
      tags: editForm.value.tags,
      enabled: editForm.value.enabled,
    });
    message.success('已保存');
    editOpen.value = false;
    await Promise.all([load(), loadTags()]);
  } catch {
    /* request 拦截器已弹错 */
  }
}

const syncingId = ref<number | null>(null);

async function onSync(asset: ContentMedia, force = false) {
  syncingId.value = asset.id;
  try {
    await syncMediaToWechat(asset.id, force);
    message.success('已同步到公众号永久素材');
    load();
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    syncingId.value = null;
  }
}

async function onDelete(asset: ContentMedia) {
  try {
    await deleteMedia(asset.id);
    message.success('已删除');
    await Promise.all([load(), loadTags()]);
  } catch {
    /* request 拦截器已弹错（被管线引用时后端会给出具体是哪个管线） */
  }
}

function onToggle(asset: ContentMedia, checked: boolean) {
  updateMedia(asset.id, { enabled: checked })
    .then(() => {
      message.success(checked ? '已启用' : '已停用');
      load();
    })
    .catch(() => {
      /* request 拦截器已弹错 */
    });
}

// ── 设为管线默认封面 ──
const bindOpen = ref(false);
const bindAsset = ref<ContentMedia | null>(null);
const pipelines = ref<ContentPipeline[]>([]);
const bindPipelineId = ref<number | null>(null);

async function openBind(asset: ContentMedia) {
  bindAsset.value = asset;
  bindPipelineId.value = null;
  try {
    pipelines.value = await listPipelines();
  } catch {
    pipelines.value = [];
  }
  bindOpen.value = true;
}

async function saveBind() {
  if (!bindAsset.value || !bindPipelineId.value) {
    message.warning('先选一条管线');
    return;
  }
  try {
    await updatePipeline(bindPipelineId.value, { default_cover_id: bindAsset.value.id });
    message.success('已设为该管线的默认封面');
    bindOpen.value = false;
  } catch {
    /* request 拦截器已弹错 */
  }
}

const stats = computed(() => {
  const total = assets.value.length;
  const synced = assets.value.filter((a) => a.synced).length;
  const ai = assets.value.filter((a) => a.source === 'ai').length;
  return { total, synced, ai };
});

function sizeText(a: ContentMedia): string {
  if (!a.width || !a.height) return '尺寸未知';
  const mb = a.bytes ? ` · ${(a.bytes / 1024 / 1024).toFixed(2)}MB` : '';
  return `${a.width}×${a.height}${mb}`;
}

onMounted(async () => {
  await Promise.all([load(), loadTags()]);
});
</script>

<template>
  <div class="page">
    <div class="header">
      <div>
        <h2>封面素材</h2>
        <div class="sub">
          共 {{ stats.total }} 张 · 已同步微信 {{ stats.synced }} 张 · AI 生成 {{ stats.ai }} 张
        </div>
      </div>
      <div class="header-actions">
        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="hidden-input"
          @change="onFileChange"
        />
        <a-button v-if="canManage" :loading="uploading" @click="pickFile">上传封面</a-button>
        <a-button v-if="canManage" type="primary" @click="openGenerate">按标题生成</a-button>
      </div>
    </div>

    <a-space class="filters" wrap>
      <a-input
        v-model:value="keyword"
        placeholder="搜名称 / 生成提示词"
        allow-clear
        style="width: 220px"
        @press-enter="load"
        @change="() => (keyword === '' ? load() : undefined)"
      />
      <a-select
        v-model:value="tag"
        placeholder="标签"
        allow-clear
        style="width: 160px"
        @change="load"
      >
        <a-select-option v-for="t in tagOptions" :key="t.tag" :value="t.tag">
          {{ t.tag }}（{{ t.count }}）
        </a-select-option>
      </a-select>
      <a-select
        v-model:value="source"
        placeholder="来源"
        allow-clear
        style="width: 130px"
        @change="load"
      >
        <a-select-option value="upload">人工上传</a-select-option>
        <a-select-option value="ai">AI 生成</a-select-option>
      </a-select>
      <a-button @click="load">查询</a-button>
    </a-space>

    <a-spin :spinning="loading">
      <a-empty v-if="!loading && assets.length === 0" description="还没有封面素材，先上传一张或按标题生成">
        <a-space>
          <a-button v-if="canManage" @click="pickFile">上传封面</a-button>
          <a-button v-if="canManage" type="primary" @click="openGenerate">按标题生成</a-button>
        </a-space>
      </a-empty>

      <div v-else class="grid">
        <a-card v-for="a in assets" :key="a.id" size="small" class="asset" :class="{ off: !a.enabled }">
          <div class="thumb">
            <img v-if="a.file_url" :src="a.file_url" :alt="a.name ?? '封面'" loading="lazy" />
            <div v-else class="thumb-empty">无图</div>
            <div class="badges">
              <a-tag :color="a.source === 'ai' ? 'purple' : 'default'" class="badge">
                {{ a.source === 'ai' ? 'AI' : '上传' }}
              </a-tag>
              <a-tag :color="a.synced ? 'green' : 'orange'" class="badge">
                {{ a.synced ? '已同步微信' : '未同步' }}
              </a-tag>
            </div>
          </div>

          <div class="meta">
            <div class="name" :title="a.name ?? ''">{{ a.name || '未命名' }}</div>
            <div class="line">
              <span class="muted">{{ sizeText(a) }}</span>
            </div>
            <div class="line">
              <a-tooltip :title="a.ratio_hint.hint">
                <a-tag :color="a.ratio_hint.ok ? 'green' : 'gold'">{{ a.ratio_hint.ratio }}</a-tag>
              </a-tooltip>
              <span class="muted">用过 {{ a.use_count }} 次</span>
            </div>
            <div v-if="a.tags.length" class="line">
              <a-tag v-for="t in a.tags" :key="t" class="tag">{{ t }}</a-tag>
            </div>
            <div v-if="a.last_error" class="line err" :title="a.last_error">
              同步失败：{{ a.last_error }}
            </div>
          </div>

          <div class="ops">
            <a-button v-if="canManage" size="small" type="link" @click="openEdit(a)">编辑</a-button>
            <a-button v-if="canManage" size="small" type="link" @click="openBind(a)">设为默认</a-button>
            <a-tooltip :title="a.synced ? '已同步过，可强制重传（media_id 失效时用）' : '上传到公众号永久素材'">
              <a-button
                v-if="canManage"
                size="small"
                type="link"
                :loading="syncingId === a.id"
                @click="onSync(a, a.synced)"
              >
                {{ a.synced ? '重传' : '同步微信' }}
              </a-button>
            </a-tooltip>
            <a-popconfirm
              v-if="canManage"
              title="删除这张封面？（如果它还是某条管线的默认封面，会被拒绝）"
              @confirm="onDelete(a)"
            >
              <a-button size="small" type="link" danger>删除</a-button>
            </a-popconfirm>
            <a-switch
              v-if="canManage"
              size="small"
              :checked="a.enabled"
              class="switch"
              @change="(v: boolean) => onToggle(a, v)"
            />
          </div>
        </a-card>
      </div>
    </a-spin>

    <!-- 按标题生成 -->
    <a-modal
      v-model:open="genOpen"
      :get-container="moduleOverlayContainer"
      title="按标题生成封面"
      :confirm-loading="generating"
      ok-text="生成"
      cancel-text="取消"
      @ok="onGenerate"
    >
      <a-form layout="vertical">
        <a-form-item label="文章标题" required>
          <a-input v-model:value="genForm.title" placeholder="例：我给 AI 造了个「家」" :disabled="generating" />
        </a-form-item>
        <a-form-item label="内容摘要（可选，补画面细节）">
          <a-textarea v-model:value="genForm.summary" :rows="2" :disabled="generating" />
        </a-form-item>
        <a-form-item label="风格追加（可选）">
          <a-input v-model:value="genForm.styleExtra" placeholder="例：国风、赛博朋克、极简线稿" :disabled="generating" />
        </a-form-item>
        <a-alert type="info" show-icon>
          <template #message>
            <span v-if="generating">正在生成…已用 {{ genElapsed }}s（通常 10~40s，请勿关闭）</span>
            <span v-else>
              生成的是 2.35:1 横幅、画面不含文字（标题由微信渲染）；一次约消耗一笔生图调用。
            </span>
          </template>
        </a-alert>
      </a-form>
    </a-modal>

    <!-- 编辑 -->
    <a-modal v-model:open="editOpen" :get-container="moduleOverlayContainer" title="编辑封面" ok-text="保存" cancel-text="取消" @ok="saveEdit">
      <a-form layout="vertical">
        <a-form-item label="名称">
          <a-input v-model:value="editForm.name" placeholder="便于以后检索，如「日报-科技渐变」" />
        </a-form-item>
        <a-form-item label="标签">
          <a-select v-model:value="editForm.tags" mode="tags" placeholder="回车添加，如：日报 / 论文 / 节日" />
        </a-form-item>
        <a-form-item label="启用">
          <a-switch v-model:checked="editForm.enabled" />
          <span class="muted hint">停用后不会出现在封面选择器里，但历史成文仍能查到</span>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 设为管线默认封面 -->
    <a-modal v-model:open="bindOpen" :get-container="moduleOverlayContainer" title="设为管线默认封面" ok-text="保存" cancel-text="取消" @ok="saveBind">
      <a-form layout="vertical">
        <a-form-item label="选择管线">
          <a-select v-model:value="bindPipelineId" placeholder="选一条管线">
            <a-select-option v-for="p in pipelines" :key="p.id" :value="p.id">
              {{ p.code }}（{{ p.type }}）
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-alert type="warning" show-icon>
          <template #message>
            定时发布没人值守，绑上默认封面后这条管线每天都会用它；想换单篇的图，走发布接口的
            <span class="mono">cover_media_id</span> 覆盖，不会影响这里的默认值。
          </template>
        </a-alert>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
}
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.header h2 {
  margin: 0;
}
.sub {
  color: var(--text-faint);
  font-size: 12px;
  margin-top: 4px;
}
.header-actions {
  display: flex;
  gap: 8px;
}
.hidden-input {
  display: none;
}
.filters {
  margin-bottom: 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.asset {
  overflow: hidden;
}
.asset.off {
  opacity: 0.55;
}
.thumb {
  position: relative;
  aspect-ratio: 2.35 / 1;
  background: var(--surface-3, #f5f5f5);
  border-radius: 6px;
  overflow: hidden;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-faint);
  font-size: 12px;
}
.badges {
  position: absolute;
  top: 6px;
  left: 6px;
  display: flex;
  gap: 4px;
}
.badge {
  margin: 0;
  font-size: 11px;
  line-height: 18px;
}
.meta {
  padding-top: 8px;
}
.name {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}
.muted {
  color: var(--text-faint);
  font-size: 12px;
}
.tag {
  margin: 0;
  font-size: 11px;
}
.err {
  color: #cf1322;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ops {
  display: flex;
  align-items: center;
  gap: 2px;
  border-top: 1px solid var(--border-subtle, #f0f0f0);
  margin-top: 8px;
  padding-top: 4px;
  flex-wrap: wrap;
}
.ops :deep(.ant-btn-link) {
  padding: 0 4px;
  font-size: 12px;
}
.switch {
  margin-left: auto;
}
.hint {
  margin-left: 8px;
}
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
</style>
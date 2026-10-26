<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import {
  listPublications,
  publicationPreview,
  rebuildPublication,
  republishPublication,
  type Publication,
  type PublicationPreview,
} from '@/api/content';
import { linkifyHtml } from '@/utils/linkify';
import { moduleOverlayContainer } from '@/utils/mount';

const userStore = useUserStore();
const canManage = userStore.hasPermission('content:manage');

const fmtTime = (s?: string | null) => (s ? String(s).slice(0, 19).replace('T', ' ') : '-');

// ── 列表（服务端筛选 + 分页）──
const filters = reactive({ target: undefined as string | undefined, status: undefined as string | undefined });
const page = reactive({ current: 1, pageSize: 20, total: 0 });
const items = ref<Publication[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await listPublications({
      limit: page.pageSize,
      offset: (page.current - 1) * page.pageSize,
      target: filters.target,
      status: filters.status,
    });
    items.value = res.items;
    page.total = res.total;
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

function onFilterChange() {
  page.current = 1;
  load();
}

function onTableChange(pag: { current: number; pageSize: number }) {
  page.current = pag.current;
  page.pageSize = pag.pageSize;
  load();
}

/**
 * 列表标题（issue-2）：优先成文标题 detail.payload.title（p40/2026-10-22 起发布即留存），
 * 其次关联条目标题，最后才落「管线成文（pipeline #N）」兜底。
 *
 * 管线级发布（item_id=0）item_title 恒 null，以前每行都叫「管线成文（pipeline #1）」，
 * 同一管线天天一条全同名，运营没法从列表区分是哪天的成文。
 *
 * 占位符兜底：2026-10-23 前定时发布有少量记录 payload.title 是未渲染的模板（{{date}} 原样），
 * 这里按本条发布时间渲染，避免列表露出裸占位符（与后端 renderPlaceholders 同语义）。
 */
function payloadTitle(p: Publication): string | null {
  const t = (p.detail as { payload?: { title?: string } } | null)?.payload?.title;
  if (!t) return null;
  return t
    .replace(/\{\{date\}\}/g, p.created_at.slice(0, 10))
    .replace(/\{\{datetime\}\}/g, p.created_at.slice(0, 16).replace('T', ' '))
    .replace(/\{\{time\}\}/g, p.created_at.slice(11, 16));
}

const rowTitle = (p: Publication) =>
  payloadTitle(p) ?? p.item_title ?? (p.pipeline_id ? `管线成文（pipeline #${p.pipeline_id}）` : '（无标题）');

/** 该发布记录是否留存了成文内容（2026-10-22 起发布才留存 payload） */
function hasPayload(p: Publication): boolean {
  const detail = p.detail as { payload?: { title?: string } } | null;
  return !!detail?.payload?.title;
}

// ── 预览抽屉（文章级聚合，Q5）──
const previewVisible = ref(false);
const previewLoading = ref(false);
const preview = ref<PublicationPreview | null>(null);

async function openPreview(p: Publication) {
  previewVisible.value = true;
  previewLoading.value = true;
  preview.value = null;
  try {
    preview.value = await publicationPreview(p.id);
  } catch {
    previewVisible.value = false;
    /* request 拦截器已弹错 */
  } finally {
    previewLoading.value = false;
  }
}

/** 失败原因标题：有机器码就带上，它是最快的定位入口（如微信 48001） */
const failureTitle = computed(() => {
  const code = preview.value?.failure?.code;
  return code ? `发布失败（错误码 ${code}）` : '发布失败';
});

/**
 * 预览正文（#433）：渲染层兜底把裸 URL 染成链接。
 *
 * stored 分支返回的是**发布当时**存下的 `payload.html`，渲染器后来修的链接化对它
 * 无效 —— 2026-10-23 前的记录点开就是纯文本。这里不再依赖「重建成文」被人工触发，
 * 而是显示时统一处理：数据脏不脏都看得对。
 *
 * 只影响后台预览；发到公众号的成品仍是 payload.html，要干净得用「重建成文」+「重新发布」。
 */
const previewHtml = computed(() => linkifyHtml(preview.value?.html));

// ── 按当前渲染器重建成文（#431）──
// 存量记录的 payload.html 是**发布当时**渲染好的产物，之后渲染器修的问题
// （裸 URL 链接化、{{date}} 替换）对它完全无效 —— 预览和重发都直传那串旧 HTML。
// 这里显式按当前渲染器重算一次并写回，只修内容、不投递。
const rebuilding = ref(false);

/** 只有 stored 需要重建：aggregated 本来就是现场按当前渲染器生成的 */
const canRebuild = computed(() => canManage && preview.value?.source === 'stored');

async function onRebuild() {
  const p = preview.value;
  if (!p) return;
  rebuilding.value = true;
  try {
    const res = await rebuildPublication(p.id);
    if (res.title_changed || res.html_changed) {
      message.success('已按当前渲染器重建成文');
    } else {
      message.info('内容已是最新，无需重建');
    }
    // 立即重拉预览，让运营当场看到「原文」变成可点链接
    preview.value = await publicationPreview(p.id);
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    rebuilding.value = false;
  }
}

// ── 重新发布（Q3）──
// 两个终点可选：草稿箱（mode=draft）/ 直接发布（mode=publish）。
// 公众号资质不足（未认证个人号 48001）时「直接发布」会降级成草稿，
// 与其每天撞一次失败，不如让运营显式选「建草稿」。
const republishingId = ref<number | null>(null);
const republishingMode = ref<'draft' | 'publish' | null>(null);

async function onRepublish(p: Publication, mode: 'draft' | 'publish') {
  republishingId.value = p.id;
  republishingMode.value = mode;
  try {
    const res = await republishPublication(p.id, mode);
    if (mode === 'draft' && res.status === 'drafted') {
      message.success(`已进草稿箱（新记录 #${res.publication_id}），请到公众号后台发布`);
    } else if (res.ok) {
      message.success(`重发成功（新记录 #${res.publication_id}）`);
    } else {
      message.error(`重发失败：${res.error ?? '未知错误'}`);
    }
    load();
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    republishingId.value = null;
    republishingMode.value = null;
  }
}

const isRepublishing = (p: Publication, mode: 'draft' | 'publish') =>
  republishingId.value === p.id && republishingMode.value === mode;

/** 只有失败 / 停在草稿箱的记录需要重投；已发布（success）不重复投 */
const canRepublish = (p: Publication) => p.status === 'failed' || p.status === 'drafted';

const TARGET_LABEL: Record<string, string> = {
  wechat_mp: '公众号',
  tencent_docs: '腾讯文档',
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  personal: '个人',
  enterprise: '企业',
};

/**
 * 状态呈现按**账号主体类型**分流（2026-10-23）。
 *
 * 同一个 status=drafted 在两种主体下是完全不同的含义：
 *   · 个人主体（未认证订阅号）：没有 freepublish 权限，微信侧返回 48001 时我们
 *     已降级成草稿 —— 草稿就是这条内容的终点，显示「草稿」即可。以前一律显示
 *     「待发布」，运营天天去点「正式发布」，再撞一次 48001，纯属挨打。
 *   · 企业主体：草稿只是中间态，显示「待发布」，给「发布」按钮，发出去后「已发布」。
 *   · 类型未登记（本功能上线前的历史记录 / 账号表没 seed）：沿用旧口径，
 *     显示「待发布」+ 两个按钮，不臆造类型。
 */
function statusLabel(p: Pick<Publication, 'status' | 'account_type'>): string {
  if (p.status === 'success') return '已发布';
  if (p.status === 'failed') return '失败';
  return p.account_type === 'personal' ? '草稿' : '待发布';
}

/** 个人号的草稿是终点（蓝色=完成），企业号的草稿是待办（橙色=还差一步） */
function statusColor(p: Pick<Publication, 'status' | 'account_type'>): string {
  if (p.status === 'success') return 'green';
  if (p.status === 'failed') return 'red';
  return p.account_type === 'personal' ? 'blue' : 'orange';
}

/** drafted 这档的说明文案：告诉运营"下一步要不要做、去哪做" */
function statusHint(p: Pick<Publication, 'status' | 'account_type'>): string {
  if (p.account_type === 'personal') {
    return '个人号无发布权限，内容已在草稿箱，需到公众号后台手动发布';
  }
  if (p.account_type === 'enterprise') {
    return '草稿已建，点「发布」即推送给读者';
  }
  return '在公众号草稿箱，需到后台手动发布';
}

/**
 * 状态列 hover 提示（issue-1）：drafted 行的操作指引 + media 定位。
 * 非 drafted 行返回空串（antd tooltip 收到空 title 不渲染，无需 v-if 双份模板）。
 * 以前这段话常驻标签下方，每行都撑出一截灰字，状态列被撑宽——改成 hover 才出现。
 */
function statusTip(p: Pick<Publication, 'status' | 'account_type' | 'media_id'>): string {
  if (p.status !== 'drafted') return '';
  const media = p.media_id ? `（media: ${String(p.media_id).slice(0, 12)}…）` : '';
  return `${statusHint(p)}${media}`;
}

/**
 * 「正式发布」入口只对**企业主体**有意义：个人主体点了也是 48001 降级回草稿。
 * 类型未登记时保留入口（历史记录，无从判断，交给运营自己试）。
 */
const canPublish = (p: Publication) =>
  canManage && hasPayload(p) && (p.account_type === 'enterprise' || !p.account_type);

/**
 * 「建草稿」入口：
 *   · 个人主体只在失败时有意义 —— 草稿已是终点，再建一条是重复稿；
 *   · 企业主体同样只在失败时需要（草稿态下一步是「发布」，不是再建一份草稿）；
 *   · 类型未登记时保留（原行为）。
 */
const canDraft = (p: Publication) =>
  canManage && hasPayload(p) && (p.status === 'failed' || !p.account_type);

const pubColumns = [
  { title: 'ID', dataIndex: 'id', width: 70 },
  { title: '标题', key: 'title', ellipsis: true },
  { title: '目标', dataIndex: 'target', width: 100 },
  { title: '状态', dataIndex: 'status', width: 90 },
  { title: '外部 ID', dataIndex: 'external_id', width: 130, ellipsis: true },
  { title: '发布时间', dataIndex: 'created_at', width: 160 },
  { title: '操作', key: 'action', width: 190 },
];

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>公众号成文</h2>
    </div>

    <div class="filters">
      <a-select
        v-model:value="filters.target"
        placeholder="发布目标"
        allow-clear
        style="width: 140px"
        @change="onFilterChange"
      >
        <a-select-option value="wechat_mp">公众号</a-select-option>
        <a-select-option value="tencent_docs">腾讯文档</a-select-option>
      </a-select>
      <a-select
        v-model:value="filters.status"
        placeholder="状态"
        allow-clear
        style="width: 120px"
        @change="onFilterChange"
      >
        <a-select-option value="success">已发布</a-select-option>
        <a-select-option value="drafted">草稿 / 待发布</a-select-option>
        <a-select-option value="failed">失败</a-select-option>
      </a-select>
      <a-button type="primary" @click="onFilterChange">查询</a-button>
    </div>

    <a-table
      :columns="pubColumns"
      :data-source="items"
      :loading="loading"
      row-key="id"
      size="middle"
      :pagination="{
        current: page.current,
        pageSize: page.pageSize,
        total: page.total,
        showSizeChanger: true,
        showTotal: (t: number) => `共 ${t} 条`,
      }"
      @change="onTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'">
          <a @click="openPreview(record)">{{ rowTitle(record) }}</a>
        </template>
        <template v-else-if="column.dataIndex === 'target'">
          <a-tag color="geekblue">{{ TARGET_LABEL[record.target] ?? record.target }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'status'">
          <!-- issue-1：说明文字改为 hover tip，不再常驻撑宽列表；空 title 时 tooltip 不渲染 -->
          <a-tooltip :title="statusTip(record)">
            <a-space :size="4">
              <a-tag :color="statusColor(record)">{{ statusLabel(record) }}</a-tag>
              <a-tag v-if="record.account_type" color="default">
                {{ ACCOUNT_TYPE_LABEL[record.account_type] ?? record.account_type }}
              </a-tag>
              <a-tag v-else color="default">未登记账号</a-tag>
            </a-space>
          </a-tooltip>
        </template>
        <template v-else-if="column.dataIndex === 'created_at'">
          {{ fmtTime(record.created_at) }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button size="small" type="link" @click="openPreview(record)">预览</a-button>
            <template v-if="canManage && canRepublish(record)">
              <a-tooltip
                v-if="canDraft(record)"
                :title="hasPayload(record) ? '只投递到公众号草稿箱，不直接发布（会在本列表新增一条记录）' : '该记录未留存成文内容（2026-10-22 前历史记录），请重跑对应管线'"
              >
                <a-button
                  size="small"
                  type="link"
                  :loading="isRepublishing(record, 'draft')"
                  :disabled="!hasPayload(record)"
                  @click="onRepublish(record, 'draft')"
                >
                  建草稿
                </a-button>
              </a-tooltip>
              <a-tooltip
                v-if="canPublish(record)"
                :title="hasPayload(record) ? '建草稿后直接提交发布（企业主体有发布权限；个人主体点了会被微信 48001 降级回草稿）' : '该记录未留存成文内容（2026-10-22 前历史记录），请重跑对应管线'"
              >
                <a-button
                  size="small"
                  type="link"
                  danger
                  :loading="isRepublishing(record, 'publish')"
                  :disabled="!hasPayload(record)"
                  @click="onRepublish(record, 'publish')"
                >
                  {{ record.status === 'drafted' ? '发布' : '正式发布' }}
                </a-button>
              </a-tooltip>
              <!-- 个人主体的草稿是终点：这里没有可点的操作，留一句说明而不是留两个点了会失败的按钮 -->
              <span
                v-if="!canDraft(record) && !canPublish(record)"
                class="muted-inline"
              >
                已完成
              </span>
            </template>
          </a-space>
        </template>
      </template>
    </a-table>

    <!--
      成文预览抽屉（文章级聚合渲染）

      🔴 get-container 不能省：微前端构建给所有 CSS 加了 :where([data-module="admin"])
      前缀做隔离，而 antd Drawer 默认 teleport 到 <body>（模块容器之外），
      抽屉里的 .preview-* 会整片匹配不上 —— 卡片/字号/层级全消失，内容贴边像纯文本。
      挂回模块容器后 DOM 位置与样式作用域才一致。详见 utils/mount.ts。
    -->
    <a-drawer
      v-model:open="previewVisible"
      :title="preview?.title ?? '成文预览'"
      width="820"
      :body-style="{ padding: '0' }"
      :get-container="moduleOverlayContainer"
    >
      <a-spin :spinning="previewLoading">
        <div v-if="preview" class="preview-wrap">
          <div class="preview-meta">
            <a-tag color="geekblue">{{ TARGET_LABEL[preview.target] ?? preview.target }}</a-tag>
            <a-tag :color="statusColor(preview)">{{ statusLabel(preview) }}</a-tag>
            <span v-if="preview.status === 'drafted'" class="muted">
              · {{ statusHint(preview) }}
            </span>
            <span class="muted">{{ fmtTime(preview.published_at) }}</span>
            <span v-if="preview.source === 'aggregated'" class="muted">
              · 按管线 + 发布日期聚合 {{ preview.item_count }} 条明细重建
            </span>
          </div>

          <div class="preview-body">
            <!--
              失败原因（#405）：此前 status=failed 只能看到一个红叉，原因得去查库。
              内容是后端白名单 + 脱敏后的串（code/message/at），不含凭证与路径。
            -->
            <div class="preview-aside">
              <a-alert
                v-if="preview.failure"
                class="preview-failure"
                type="error"
                show-icon
                :message="failureTitle"
              >
                <template #description>
                  <div class="failure-msg">{{ preview.failure.message }}</div>
                  <div v-if="preview.failure.at" class="muted">
                    失败于 {{ fmtTime(preview.failure.at) }}
                  </div>
                </template>
              </a-alert>
              <!--
                存量记录重建（#431）：payload.html 是发布当时的产物，渲染器升级对它无效。
                只在 stored 出现 —— aggregated 本来就按当前渲染器现算，不需要重算。
              -->
              <div v-if="canRebuild" class="preview-toolbar">
                <a-button size="small" :loading="rebuilding" @click="onRebuild">
                  重建成文（按当前渲染器）
                </a-button>
                <span class="muted">仅重算库里存的标题与正文，不投递、不新增记录</span>
              </div>
            </div>

            <!-- 成文 HTML 由自家管线 LLM 生成后留存/重建，非用户输入 -->
            <!-- previewHtml 在渲染层把裸 URL 兜底成链接（#433），不依赖数据是否洗过 -->
            <!-- 版面按公众号阅读版心呈现（#436）：680 版心 / 16px / 1.8 行高 -->
            <div class="preview-paper">
              <div v-if="previewHtml" class="preview-html" v-html="previewHtml" />
              <a-empty v-else description="该记录未留存成文内容，请重跑对应管线" />
            </div>
          </div>
        </div>
      </a-spin>
    </a-drawer>
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
  align-items: center;
  margin-bottom: 16px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  align-items: center;
}
/* ── 成文预览（#436）：让运营看到的就是读者在手机上看到的样子 ──
   纸张浮在页面底色上 + 680 版心 + 16px/1.8 行高，颜色全走 @web-system/ui 语义
   token（light / dark 自动跟随）。此处只做「显示」，不改产物。 */
.preview-wrap {
  min-height: 100%;
  background: var(--ws-bg-page);
}
.preview-body {
  padding: 0 24px 40px;
}
.preview-meta {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: var(--ws-bg-surface);
  border-bottom: 1px solid var(--ws-border-subtle);
}
.muted {
  color: var(--ws-text-tertiary);
  font-size: 12px;
}
/* 个人主体的草稿是终点：操作列只剩这句说明，避免占位空白让人以为按钮没渲染出来 */
.muted-inline {
  font-size: 12px;
  color: var(--ws-text-tertiary);
}
.preview-aside {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 680px;
  margin: 0 auto;
  padding-top: 16px;
}
.preview-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background: var(--ws-bg-surface);
  border: 1px dashed var(--ws-border-subtle);
  border-radius: var(--r-control, 6px);
}
.preview-paper {
  box-sizing: border-box;
  max-width: 680px;
  margin: 20px auto 0;
  padding: 40px 36px 44px;
  background: var(--ws-bg-surface);
  border: 1px solid var(--ws-border-subtle);
  border-radius: var(--r-card, 8px);
  box-shadow: var(--ws-shadow-card);
}
.failure-msg {
  word-break: break-all;
  font-family: var(--ws-font-mono);
  font-size: 12px;
  line-height: 1.7;
}

/* ── 正文排版 ── */
.preview-html {
  font-family: var(--ws-font-sans);
  font-size: 16px;
  line-height: 1.8;
  letter-spacing: 0.2px;
  color: var(--ws-text-body);
  overflow-wrap: break-word;
  word-break: break-word;
  -webkit-font-smoothing: antialiased;
}
/* 文章主标题：渲染器把 `#` 降级成 h2，首个标题元素即标题 */
.preview-html :deep(> h1:first-child),
.preview-html :deep(> h2:first-child) {
  margin: 0 0 24px;
  padding: 0 0 18px;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: -0.2px;
  color: var(--ws-text-primary);
  border-bottom: 1px solid var(--ws-border-subtle);
}
.preview-html :deep(> h1:first-child)::before,
.preview-html :deep(> h2:first-child)::before {
  content: none;
}
/* 章节标题：橙色竖条（top/height 按首行行盒定，多行标题也不错位） */
.preview-html :deep(h2) {
  position: relative;
  margin: 36px 0 14px;
  padding-left: 12px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.55;
  letter-spacing: 0;
  color: var(--ws-text-primary);
}
.preview-html :deep(h2)::before {
  content: '';
  position: absolute;
  left: 0;
  top: 6px;
  width: 3px;
  height: 16px;
  border-radius: 2px;
  background: var(--ws-brand-500);
}
.preview-html :deep(h3) {
  margin: 26px 0 10px;
  font-size: 16.5px;
  font-weight: 600;
  line-height: 1.6;
  color: var(--ws-text-primary);
}
.preview-html :deep(h3)::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--ws-brand-500);
  vertical-align: 3px;
}
.preview-html :deep(h4) {
  margin: 22px 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ws-text-secondary);
}
.preview-html :deep(h5),
.preview-html :deep(h6) {
  margin: 18px 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ws-text-secondary);
}
.preview-html :deep(p) {
  margin: 0 0 18px;
}
.preview-html :deep(> *:last-child) {
  margin-bottom: 0;
}
/* 列表：橙色圆点记号（日报全是条目，这层最影响观感） */
.preview-html :deep(ul) {
  margin: 0 0 18px;
  padding-left: 20px;
  list-style: none;
}
.preview-html :deep(ul > li) {
  position: relative;
  margin-bottom: 10px;
}
.preview-html :deep(ul > li)::before {
  content: '';
  position: absolute;
  left: -14px;
  top: 0.74em;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ws-brand-400);
}
.preview-html :deep(ul > li:last-child) {
  margin-bottom: 0;
}
.preview-html :deep(ol) {
  margin: 0 0 18px;
  padding-left: 22px;
}
.preview-html :deep(ol li) {
  margin-bottom: 10px;
  padding-left: 2px;
}
.preview-html :deep(ol > li:last-child) {
  margin-bottom: 0;
}
.preview-html :deep(ol li)::marker {
  color: var(--ws-brand-500);
  font-weight: 600;
}
/* 链接：发丝下划线；长 URL 必须能断行，否则版心被撑破 */
.preview-html :deep(a) {
  color: var(--ws-brand-600);
  text-decoration: none;
  border-bottom: 1px solid rgba(249, 115, 22, 0.35);
  transition: color 150ms var(--ws-ease-out), border-color 150ms var(--ws-ease-out);
}
.preview-html :deep(a:hover) {
  color: var(--ws-brand-500);
  border-bottom-color: var(--ws-brand-500);
}
/* 暗底上 #EA580C 与纸面 #1A1A1A 对比不足，亮一档 */
[data-theme='dark'] .preview-html :deep(a) {
  color: var(--ws-brand-400);
  border-bottom-color: rgba(251, 146, 60, 0.35);
}
[data-theme='dark'] .preview-html :deep(a:hover) {
  color: var(--ws-brand-300);
  border-bottom-color: var(--ws-brand-300);
}
.preview-html :deep(strong),
.preview-html :deep(b) {
  font-weight: 600;
  color: var(--ws-text-strong);
}
.preview-html :deep(em) {
  font-style: normal;
  font-weight: 500;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(249, 115, 22, 0.14);
}
.preview-html :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 22px auto;
  border-radius: var(--r-control, 6px);
}
.preview-html :deep(figure) {
  margin: 22px 0;
}
.preview-html :deep(figcaption) {
  margin-top: 8px;
  font-size: 13px;
  text-align: center;
  color: var(--ws-text-tertiary);
}
/* 引用 / 代码 / 表头底色用 bg-hover：暗色下 bg-subtle 比纸面更深，会像挖了个洞 */
.preview-html :deep(blockquote) {
  margin: 22px 0;
  padding: 14px 18px;
  background: var(--ws-bg-hover);
  border-left: 3px solid var(--ws-brand-500);
  border-radius: 0 var(--r-control, 6px) var(--r-control, 6px) 0;
  color: var(--ws-text-secondary);
}
.preview-html :deep(blockquote p:last-child) {
  margin-bottom: 0;
}
.preview-html :deep(code) {
  padding: 2px 6px;
  font-family: var(--ws-font-mono);
  font-size: 0.88em;
  color: var(--ws-text-secondary);
  background: var(--ws-bg-hover);
  border-radius: var(--r-chip, 4px);
}
.preview-html :deep(pre) {
  margin: 22px 0;
  padding: 16px 18px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.7;
  background: var(--ws-code-bg);
  border-radius: var(--r-control, 6px);
}
.preview-html :deep(pre code) {
  padding: 0;
  font-size: inherit;
  color: var(--ws-code-text);
  background: none;
  border-radius: 0;
}
.preview-html :deep(table) {
  width: 100%;
  margin: 22px 0;
  border-collapse: collapse;
  font-size: 14px;
}
.preview-html :deep(th),
.preview-html :deep(td) {
  padding: 10px 12px;
  text-align: left;
  border: 1px solid var(--ws-border-subtle);
}
.preview-html :deep(th) {
  font-weight: 600;
  color: var(--ws-text-primary);
  background: var(--ws-bg-hover);
}
.preview-html :deep(hr) {
  margin: 30px 0;
  border: 0;
  border-top: 1px solid var(--ws-border-subtle);
}

@media (max-width: 760px) {
  .preview-body {
    padding: 0 12px 24px;
  }
  .preview-paper {
    padding: 26px 18px 30px;
  }
}
</style>

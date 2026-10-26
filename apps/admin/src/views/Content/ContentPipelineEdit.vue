<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  getPipeline,
  createPipeline,
  updatePipeline,
  listWechatCovers,
  type ContentPipeline,
  type WechatCoverItem,
} from '@/api/content';

const route = useRoute();
const router = useRouter();

const isNew = computed(() => route.name === 'ContentPipelineCreate');
const pipelineId = computed(() => (isNew.value ? null : Number(route.params.id)));

/**
 * 管线类型。后端 categoryByType 支持 paper / ai-news / hot-news；
 * 此前只列了前两个 → 热点资讯管线只能靠 SQL 建。2026-10-26 补齐。
 */
const PIPELINE_TYPES = ['paper', 'ai-news', 'hot-news'];
const PUBLISH_TARGETS = [
  // 腾讯文档通道 2026-10-23 下线（A5），发布目标只剩公众号。
  // 历史 target=tencent_docs 的记录仍在库里，列表页的显示映射保留，只是不能再新建。
  { value: 'wechat_mp', label: '公众号' },
];

/**
 * 发布模式：公众号通道的终点。
 * draft 不是失败态——公众号没开通发布接口权限（未认证个人号 48001）时，
 * 「直接发布」必然降级，与其每天撞一次红叉，不如把草稿设成管线的预期终点。
 */
const PUBLISH_MODES = [
  { value: 'publish', label: '直接发布（建草稿后提交）' },
  { value: 'draft', label: '只建草稿（停在草稿箱待人工发布）' },
];

const form = reactive({
  code: '',
  type: 'paper',
  title_template: '',
  cron: '0 9 * * *',
  llm_prompt: '',
  publish_targets: [] as string[],
  publish_mode: 'publish' as 'draft' | 'publish',
  // issue-5：管线级公众号封面素材 media_id，留空走内置通用封面
  cover_media_id: '',
  // 素材库封面（content_media.id），优先级高于 cover_media_id
  default_cover_id: null as number | null,
  enabled: true,
});

// ── 封面：素材库选择器（选图即见图）+ 手动 media_id 兜底 ──

/** 素材库列表（只读接口，失败降级为手动模式，不阻断编辑） */
const covers = ref<WechatCoverItem[]>([]);
const coversLoading = ref(false);
const coversFailed = ref(false);

/**
 * 输入模式：
 *  - pick   从素材库下拉选（带缩略图）
 *  - custom 手动粘贴 media_id（素材库查不到时的兜底）
 * 同一字段 two-way，避免两套输入互相打架。
 */
const coverMode = ref<'pick' | 'custom'>('pick');

const coverOptions = computed(() => {
  const opts = covers.value.map((c) => ({
    value: c.media_id,
    label: c.name || `素材 #${c.media_id.slice(0, 8)}`,
    url: c.url,
  }));
  // 当前值不在素材库里 → 补一条占位，否则 select 显示裸 id 很难读
  const cur = form.cover_media_id.trim();
  if (cur && !opts.some((o) => o.value === cur)) {
    opts.unshift({ value: cur, label: `自定义 · ${cur.slice(0, 16)}…`, url: '' });
  }
  return opts;
});

/** 预览用：解析当前 media_id 对应的封面图与名字 */
const selectedCover = computed(() => {
  const cur = form.cover_media_id.trim();
  if (!cur) return null;
  return covers.value.find((c) => c.media_id === cur) ?? null;
});

async function loadCovers() {
  coversLoading.value = true;
  coversFailed.value = false;
  try {
    const res = await listWechatCovers();
    covers.value = res.items ?? [];
  } catch {
    // 素材列表拿不到就退回手动输入——封面是增强项，不该让人连 cron 都改不了
    coversFailed.value = true;
    coverMode.value = form.cover_media_id ? coverMode.value : 'custom';
  } finally {
    coversLoading.value = false;
  }
}

// ── 标题模板 live 预览（对齐后端 title.util.ts 的 renderPlaceholders 语义）──

const TITLE_TZ = 'Asia/Shanghai';

/** 占位符字面量（模板里嵌套 {{ }} 会触发解析错误，故放 script） */
const PH_DATE = '{{date}}';
const PH_TIME = '{{time}}';
const PH_DATETIME = '{{datetime}}';

/** 本地时区日期/时间片段，与后端 localParts 一致（含午夜 24→00 修正） */
function localParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TITLE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hour}:${get('minute')}`,
  };
}

/** 占位符全量替换，顺序与后端一致：datetime → date → time */
function renderPlaceholders(text: string, date: Date = new Date()): string {
  const { date: d, time: t } = localParts(date);
  return text
    .split('{{datetime}}')
    .join(`${d} ${t}`)
    .split('{{date}}')
    .join(d)
    .split('{{time}}')
    .join(t);
}

const titlePreview = computed(() => {
  const tpl = form.title_template.trim();
  if (!tpl) return '（未设置标题模板，将用默认标题）';
  return renderPlaceholders(tpl);
});

const modeLabel = computed(
  () => PUBLISH_MODES.find((m) => m.value === form.publish_mode)?.label ?? form.publish_mode,
);
const typeLabel = computed(() => form.type);

const loading = ref(false);
const saving = ref(false);

async function loadPipeline() {
  if (isNew.value || !pipelineId.value) return;
  loading.value = true;
  try {
    const p: ContentPipeline = await getPipeline(pipelineId.value);
    Object.assign(form, {
      code: p.code,
      type: p.type,
      title_template: p.title_template ?? '',
      cron: p.cron,
      llm_prompt: p.llm_prompt ?? '',
      publish_targets: p.publish_targets ?? [],
      publish_mode: (p.publish_mode as 'draft' | 'publish') ?? 'publish',
      // issue-3：腾讯文档目录字段已从表单下线（腾讯文档通道 2026-10-23 停发）。
      // 这里不再读写 tencent_folder —— 不出现在 dto 里，update 就不会动历史值。
      cover_media_id: p.cover_media_id ?? '',
      default_cover_id: (p as any).default_cover_id ?? null,
      enabled: p.enabled,
    });
    // 回填后判定输入模式：值不在素材库 → 切到手动，避免 select 显示一堆看不清的字符
    if (p.cover_media_id && !covers.value.some((c) => c.media_id === p.cover_media_id)) {
      coverMode.value = 'custom';
    }
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

async function submit() {
  if (!form.code.trim() || !form.cron.trim()) {
    message.warning('code 与 cron 必填');
    return;
  }
  const dto = {
    code: form.code.trim(),
    type: form.type,
    title_template: form.title_template || null,
    cron: form.cron.trim(),
    llm_prompt: form.llm_prompt || null,
    publish_targets: form.publish_targets,
    publish_mode: form.publish_mode,
    cover_media_id: form.cover_media_id.trim() || null,
    default_cover_id: form.default_cover_id,
    enabled: form.enabled,
  };
  saving.value = true;
  try {
    if (isNew.value) {
      await createPipeline(dto);
      message.success('管线已创建');
    } else {
      await updatePipeline(pipelineId.value!, dto);
      message.success('管线已更新');
    }
    router.push('/content/pipelines');
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  void loadPipeline();
  void loadCovers();
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <a-button type="text" class="back-btn" @click="router.push('/content/pipelines')">
        ← 返回发布管线
      </a-button>
      <h2>{{ isNew ? '新建管线' : `编辑管线：${form.code}` }}</h2>
    </div>

    <!-- 1280 双栏：左编辑、右预览（sticky）。预览随表单即时变化，不用保存就能看到效果 -->
    <div class="layout">
      <!-- ── 左：表单 ── -->
      <a-form layout="vertical" class="pipeline-form" :loading="loading">
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="编码 code" required>
              <a-input v-model:value="form.code" placeholder="如 daily_paper" :disabled="!isNew" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="类型" required>
              <a-select v-model:value="form.type">
                <a-select-option v-for="t in PIPELINE_TYPES" :key="t" :value="t">{{ t }}</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="cron 表达式" required>
              <a-input v-model:value="form.cron" placeholder="0 9 * * *" class="mono" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="标题模板">
              <a-input v-model:value="form.title_template" placeholder="每日论文速览 ｜ {{date}}" />
              <div class="field-hint">
                支持占位符 <span class="mono">{{ PH_DATE }}</span> / <span class="mono">{{ PH_TIME }}</span> /
                <span class="mono">{{ PH_DATETIME }}</span>，右侧实时预览效果。
              </div>
            </a-form-item>
          </a-col>
        </a-row>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="发布目标">
              <a-select v-model:value="form.publish_targets" mode="multiple" placeholder="选择发布通道">
                <a-select-option v-for="t in PUBLISH_TARGETS" :key="t.value" :value="t.value">
                  {{ t.label }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="发布模式">
              <a-select v-model:value="form.publish_mode">
                <a-select-option v-for="m in PUBLISH_MODES" :key="m.value" :value="m.value">
                  {{ m.label }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <!-- issue-5 封面 + 预览：选图即见图 -->
        <a-form-item label="公众号封面">
          <div class="cover-mode-row">
            <a-segmented
              v-model:value="coverMode"
              :options="[
                { label: '从素材库选', value: 'pick' },
                { label: '手动填 media_id', value: 'custom' },
              ]"
            />
          </div>
          <a-select
            v-if="coverMode === 'pick'"
            v-model:value="form.cover_media_id"
            :options="coverOptions"
            placeholder="选择封面素材（选图即见图）"
            allow-clear
            show-search
            option-filter-prop="label"
            :loading="coversLoading"
          >
            <template #option="{ label, url }">
              <div class="cover-option">
                <img v-if="url" :src="url" alt="" class="cover-option-thumb" />
                <span v-else class="cover-option-thumb cover-option-thumb--empty">?</span>
                <span class="cover-option-name">{{ label }}</span>
              </div>
            </template>
          </a-select>
          <a-input
            v-else
            v-model:value="form.cover_media_id"
            placeholder="封面素材 media_id，如 BUSabtk9juW9…"
            class="mono"
            allow-clear
          />
          <div class="field-hint">
            <template v-if="coversFailed">
              素材库列表暂不可用，请手动填 media_id；或稍后重试。
            </template>
            <template v-else-if="coverMode === 'pick'">
              留空则用默认通用封面（正文有图时优先用正文首图）。右侧显示选中封面的实图。
            </template>
            <template v-else>
              公众号「素材管理」上传封面图后取 media_id 填入；留空则用默认通用封面。
            </template>
          </div>
        </a-form-item>

        <a-form-item label="启用">
          <a-switch v-model:checked="form.enabled" />
        </a-form-item>

        <a-form-item label="LLM prompt 模板">
          <a-textarea
            v-model:value="form.llm_prompt"
            :rows="10"
            placeholder="可选，留空走默认。粘贴的 prompt 必须让模型只输出 JSON，且 key 名与代码解析一致"
            class="mono"
          />
          <div class="field-hint">
            <b>JSON key 契约</b>：
            <template v-if="form.type === 'paper'">译名 / 核心贡献 / 方法亮点 / 潜在应用（译名会同时作为文章标题）</template>
            <template v-else>标题 / 摘要 / 标签 / 分类</template>
            。<br />
            <b>标题</b> 是可选的：带上它，英文源的中文标题和摘要一次调用就能拿到（零额外成本）；
            不带也不会漏翻，代码会单独补一次翻译调用。key 名写错 = 该字段走兜底，不会报错。
          </div>
        </a-form-item>

        <div class="form-foot">
          <a-space>
            <a-button type="primary" :loading="saving" @click="submit">保存</a-button>
            <a-button @click="router.push('/content/pipelines')">取消</a-button>
          </a-space>
        </div>
      </a-form>

      <!-- ── 右：预览面板 ── -->
      <aside class="preview-panel">
        <div class="preview-card">
          <div class="preview-title">封面预览</div>
          <div class="cover-stage">
            <img
              v-if="selectedCover?.url"
              :src="selectedCover.url"
              :alt="selectedCover.name || '封面'"
              class="cover-stage-img"
            />
            <div v-else-if="form.cover_media_id.trim()" class="cover-stage-empty">
              <div class="cover-stage-empty-icon">🖼</div>
              <div>未在素材库找到该 media_id</div>
              <div class="cover-stage-empty-sub">仍会按 media_id 投递，只是这里预览不到图</div>
            </div>
            <div v-else class="cover-stage-empty">
              <div class="cover-stage-empty-icon">🖼</div>
              <div>未指定封面</div>
              <div class="cover-stage-empty-sub">将用默认通用封面 / 正文首图</div>
            </div>
          </div>
          <div v-if="selectedCover" class="cover-stage-meta">
            {{ selectedCover.name || '未命名素材' }}
          </div>
        </div>

        <div class="preview-card">
          <div class="preview-title">标题效果</div>
          <div class="title-preview" :class="{ 'title-preview--empty': !form.title_template.trim() }">
            {{ titlePreview }}
          </div>
          <div v-if="form.title_template.trim()" class="preview-sub">
            模板：<span class="mono">{{ form.title_template }}</span>
          </div>
        </div>

        <div class="preview-card">
          <div class="preview-title">发布摘要</div>
          <ul class="summary-list">
            <li>
              <span class="summary-key">类型</span>
              <span class="summary-val">{{ typeLabel }}</span>
            </li>
            <li>
              <span class="summary-key">目标</span>
              <span class="summary-val">{{ form.publish_targets.join('、') || '未选' }}</span>
            </li>
            <li>
              <span class="summary-key">模式</span>
              <span class="summary-val">{{ modeLabel }}</span>
            </li>
            <li>
              <span class="summary-key">状态</span>
              <span class="summary-val">
                <a-tag :color="form.enabled ? 'green' : 'default'">
                  {{ form.enabled ? '已启用' : '已停用' }}
                </a-tag>
              </span>
            </li>
            <li>
              <span class="summary-key">封面</span>
              <span class="summary-val">
                {{ selectedCover?.name || (form.cover_media_id.trim() ? '自定义 media_id' : '默认兜底') }}
              </span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  /* 与其它管理页对齐：960 太窄，字段平铺没有「编辑/预览」节奏 */
  max-width: 1280px;
  margin: 0 auto;
}
.page-head {
  margin-bottom: 16px;
}
.page-head h2 {
  margin: 8px 0 0;
  font-size: 18px;
}
.back-btn {
  padding-left: 0;
  color: var(--text-tertiary);
}

/* 双栏：左编辑（自适应）+ 右预览（固定 360，sticky 跟随） */
.layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.pipeline-form {
  flex: 1;
  min-width: 0;
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  padding: 20px;
}
.preview-panel {
  width: 360px;
  flex-shrink: 0;
  position: sticky;
  top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview-card {
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  padding: 14px 16px;
}
.preview-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-faint);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  margin-bottom: 10px;
}
.preview-sub {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-faint);
  word-break: break-all;
}

/* 封面舞台：2.35:1 是公众号头条封面比例 */
.cover-stage {
  width: 100%;
  aspect-ratio: 2.35 / 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-2, #f5f5f7);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover-stage-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cover-stage-empty {
  text-align: center;
  color: var(--text-faint);
  font-size: 12px;
  padding: 8px;
  line-height: 1.7;
}
.cover-stage-empty-icon {
  font-size: 22px;
  opacity: 0.55;
  margin-bottom: 2px;
}
.cover-stage-empty-sub {
  opacity: 0.75;
  font-size: 11px;
}
.cover-stage-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-faint);
  word-break: break-all;
}

/* 标题效果 */
.title-preview {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.55;
  color: var(--text-primary, #1f2329);
  word-break: break-word;
}
.title-preview--empty {
  font-weight: 400;
  color: var(--text-faint);
  font-size: 13px;
}

/* 发布摘要 */
.summary-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.summary-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.summary-key {
  color: var(--text-faint);
  flex-shrink: 0;
}
.summary-val {
  color: var(--text-primary, #1f2329);
  text-align: right;
  word-break: break-all;
}

/* 封面下拉项：缩略图 + 名称 */
.cover-mode-row {
  margin-bottom: 8px;
}
.cover-option {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cover-option-thumb {
  width: 56px;
  height: 24px;
  object-fit: cover;
  border-radius: 3px;
  flex-shrink: 0;
  background: var(--surface-2, #eee);
}
.cover-option-thumb--empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: 11px;
}
.cover-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
.field-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-faint);
}
.form-foot {
  margin-top: 8px;
}

/* 窄屏：预览面板落到表单下方，不挤成三栏 */
@media (max-width: 1100px) {
  .layout {
    flex-direction: column;
  }
  .preview-panel {
    width: 100%;
    position: static;
  }
}
</style>

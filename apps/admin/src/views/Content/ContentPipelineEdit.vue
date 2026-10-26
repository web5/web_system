<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  getPipeline,
  createPipeline,
  updatePipeline,
  listMedia,
  type ContentPipeline,
  type ContentMedia,
} from '@/api/content';

const route = useRoute();
const router = useRouter();

const isNew = computed(() => route.name === 'ContentPipelineCreate');
const pipelineId = computed(() => (isNew.value ? null : Number(route.params.id)));

/**
 * 管线类型。后端 `pipeline.service.ts` 的 `categoryByType` 已支持 paper / ai-news / hot-news，
 * 前端此前只列了前两个 → 热点资讯管线只能靠 SQL 建，admin 里建不出来。2026-10-26 补齐。
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
  default_cover_id: null as number | null,
  tencent_folder: '',
  enabled: true,
});

/**
 * 可选封面（只列启用的）。
 *
 * 只加载启用素材：停用的通常是裁错了/过期的图，放进下拉里只会误选。
 * 加载失败不阻断编辑 —— 封面是增强项，不该让人连 cron 都改不了。
 */
const coverOptions = ref<ContentMedia[]>([]);
const selectedCover = computed(
  () => coverOptions.value.find((m) => m.id === form.default_cover_id) ?? null,
);

async function loadCovers() {
  try {
    coverOptions.value = await listMedia({ enabled: '1' });
  } catch {
    coverOptions.value = [];
  }
}

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
      default_cover_id: p.default_cover_id ?? null,
      tencent_folder: p.tencent_folder ?? '',
      enabled: p.enabled,
    });
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
    default_cover_id: form.default_cover_id,
    tencent_folder: form.tencent_folder || null,
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
      <a-button type="text" class="back-btn" @click="router.push('/content/pipelines')">← 返回发布管线</a-button>
      <h2>{{ isNew ? '新建管线' : `编辑管线：${form.code}` }}</h2>
    </div>

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
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item label="发布目标">
        <a-select v-model:value="form.publish_targets" mode="multiple" placeholder="选择发布通道">
          <a-select-option v-for="t in PUBLISH_TARGETS" :key="t.value" :value="t.value">{{ t.label }}</a-select-option>
        </a-select>
      </a-form-item>
      <a-form-item label="发布模式">
        <a-select v-model:value="form.publish_mode">
          <a-select-option v-for="m in PUBLISH_MODES" :key="m.value" :value="m.value">{{ m.label }}</a-select-option>
        </a-select>
        <div class="field-hint">
          仅对「公众号」目标生效；腾讯文档没有草稿概念，始终直接发布。
        </div>
      </a-form-item>
      <a-form-item label="默认封面">
        <a-select
          v-model:value="form.default_cover_id"
          placeholder="不绑定则用正文首图 / 通用兜底封面"
          allow-clear
          style="max-width: 420px"
        >
          <a-select-option v-for="m in coverOptions" :key="m.id" :value="m.id">
            {{ m.name || `素材 #${m.id}` }}{{ m.synced ? '（已同步微信）' : '（首次发布自动同步）' }}
          </a-select-option>
        </a-select>
        <div v-if="selectedCover" class="cover-preview">
          <img :src="selectedCover.file_url ?? ''" :alt="selectedCover.name ?? '封面'" />
          <span class="cover-meta">
            {{ selectedCover.ratio_hint.ratio }} · {{ selectedCover.ratio_hint.hint }}
          </span>
        </div>
        <div class="field-hint">
          定时发布没人值守：绑上默认封面后，每次跑这条管线都用它。单篇想换图，走发布接口的
          <span class="mono">cover_media_id</span> 覆盖，不影响这里的默认值。
        </div>
      </a-form-item>
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="腾讯文档目录">
            <a-input v-model:value="form.tencent_folder" placeholder="每日论文学习" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="启用">
            <a-switch v-model:checked="form.enabled" />
          </a-form-item>
        </a-col>
      </a-row>
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
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 960px;
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
.pipeline-form {
  background: var(--surface-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-card);
  padding: 20px;
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
/* 选了封面就把图亮出来：只显示名字的话，很容易绑错成上一版设计稿 */
.cover-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.cover-preview img {
  width: 180px;
  aspect-ratio: 2.35 / 1;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--border-subtle, #eee);
}
.cover-meta {
  font-size: 12px;
  color: var(--text-faint);
}
.form-foot {
  margin-top: 8px;
}
</style>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  getPipeline,
  createPipeline,
  updatePipeline,
  type ContentPipeline,
} from '@/api/content';

const route = useRoute();
const router = useRouter();

const isNew = computed(() => route.name === 'ContentPipelineCreate');
const pipelineId = computed(() => (isNew.value ? null : Number(route.params.id)));

const PIPELINE_TYPES = ['paper', 'ai-news'];
const PUBLISH_TARGETS = [
  { value: 'tencent_docs', label: '腾讯文档' },
  { value: 'wechat_mp', label: '公众号' },
];

const form = reactive({
  code: '',
  type: 'paper',
  title_template: '',
  cron: '0 9 * * *',
  llm_prompt: '',
  publish_targets: [] as string[],
  tencent_folder: '',
  enabled: true,
});

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

onMounted(loadPipeline);
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
        <a-textarea v-model:value="form.llm_prompt" :rows="4" placeholder="可选，留空走默认" class="mono" />
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
.form-foot {
  margin-top: 8px;
}
</style>

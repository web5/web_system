<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  getSource,
  createSource,
  updateSource,
  testCollect,
  type ContentSource,
  type TestCollectResult,
} from '@/api/content';

const route = useRoute();
const router = useRouter();

const isNew = computed(() => route.name === 'ContentSourceCreate');
const sourceId = computed(() => (isNew.value ? null : Number(route.params.id)));

const SOURCE_TYPES = [
  { value: 'arxiv', label: 'arxiv · arXiv 论文' },
  { value: 'sina_news', label: 'sina_news · 新浪财经快讯' },
  { value: 'eastmoney_news', label: 'eastmoney_news · 东方财富快讯' },
  { value: 'eastmoney_lhb', label: 'eastmoney_lhb · 东方财富龙虎榜' },
  { value: 'hackernews', label: 'hackernews · Hacker News' },
  { value: 'rss', label: 'rss · RSS 订阅' },
];
const CATEGORIES = ['论文', '财经', 'AI'];

/** 由定时管线自动采集的类型（编辑保存不影响管线运行；手动触发已支持） */
const PIPELINE_DRIVEN_TYPES = ['arxiv', 'hackernews', 'rss'];

const form = reactive({
  code: '',
  name: '',
  type: 'rss',
  category: 'AI',
  configText: '{}',
  enabled: true,
});

const loading = ref(false);
const saving = ref(false);

async function loadSource() {
  if (isNew.value || !sourceId.value) return;
  loading.value = true;
  try {
    const s: ContentSource = await getSource(sourceId.value);
    Object.assign(form, {
      code: s.code,
      name: s.name,
      type: s.type,
      category: s.category ?? 'AI',
      configText: JSON.stringify(s.config ?? {}, null, 2),
      enabled: s.enabled,
    });
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

/** 解析表单 config JSON；不合法时弹提示并返回 null */
function parseConfig(): Record<string, unknown> | null {
  try {
    return JSON.parse(form.configText || '{}');
  } catch {
    message.warning('config 必须是合法 JSON，先修正再操作');
    return null;
  }
}

async function submit() {
  if (!form.code.trim() || !form.name.trim()) {
    message.warning('code 与名称必填');
    return;
  }
  const config = parseConfig();
  if (!config) return;
  const dto = {
    code: form.code.trim(),
    name: form.name.trim(),
    type: form.type,
    category: form.category,
    config,
    enabled: form.enabled,
  };
  saving.value = true;
  try {
    if (isNew.value) {
      await createSource(dto);
      message.success('采集源已创建');
    } else {
      await updateSource(sourceId.value!, dto);
      message.success('采集源已更新');
    }
    router.push('/content');
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    saving.value = false;
  }
}

// ── 测试采集（仅预览 · 不入库）──
const testBtnLoading = ref(false);
const testResult = ref<TestCollectResult | null>(null);
const testPanelVisible = ref(false);

async function runTest() {
  const config = parseConfig();
  if (!config) return;
  testBtnLoading.value = true;
  try {
    // 试采测的是当前表单配置（未保存也可测，D9）；服务端 clamp 前 5 条
    testResult.value = await testCollect({ type: form.type, config, limit: 5 });
    testPanelVisible.value = true;
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    testBtnLoading.value = false;
  }
}

/** 试采条目日期展示（publish_date 可能为 null） */
const fmtDate = (s?: string | null) => (s ? String(s).slice(0, 10) : '-');

onMounted(loadSource);
</script>

<template>
  <div class="page" :loading="loading">
    <div class="page-head">
      <a-button type="text" class="back-btn" @click="router.push('/content')">← 返回采集源管理</a-button>
      <h2>{{ isNew ? '新建采集源' : `编辑采集源：${form.name || form.code}` }}</h2>
    </div>

    <!-- 类型告警（Q7：定时管线驱动类型常驻提示） -->
    <a-alert
      v-if="PIPELINE_DRIVEN_TYPES.includes(form.type)"
      type="info"
      show-icon
      style="margin-bottom: 16px"
    >
      <template #message>该类型由定时管线自动采集</template>
      <template #description>
        编辑保存不影响管线运行；试采可先验证当前配置能否取到数据。
      </template>
    </a-alert>

    <a-form layout="vertical" class="src-form">
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="编码 code" required>
            <a-input v-model:value="form.code" placeholder="如 rss-wsj" :disabled="!isNew" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="名称" required>
            <a-input v-model:value="form.name" placeholder="如 华尔街见闻 RSS" />
          </a-form-item>
        </a-col>
      </a-row>
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="采集器类型" required>
            <a-select v-model:value="form.type">
              <a-select-option v-for="t in SOURCE_TYPES" :key="t.value" :value="t.value">{{ t.label }}</a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="内容领域">
            <a-select v-model:value="form.category">
              <a-select-option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
      </a-row>
      <a-form-item label="私有配置 config（JSON）">
        <a-textarea
          v-model:value="form.configText"
          :rows="6"
          placeholder='各源私有参数，如 rss：{"url":"https://..."}；arxiv：{"categories":"cs.AI","max_results":10}'
          class="mono"
        />
      </a-form-item>
      <a-form-item label="启用">
        <a-switch v-model:checked="form.enabled" />
      </a-form-item>

      <div class="form-foot">
        <a-space>
          <a-button type="primary" :loading="saving" @click="submit">保存</a-button>
          <a-button @click="router.push('/content')">取消</a-button>
        </a-space>
        <a-tooltip title="按当前表单配置调采集器，仅预览取回结果，不写入采集明细、不计入采集记录">
          <a-button :loading="testBtnLoading" @click="runTest">测试采集</a-button>
        </a-tooltip>
      </div>
    </a-form>

    <!-- 试采结果面板：与表单同屏，便于对照配置看结果 -->
    <a-card v-if="testPanelVisible" class="test-panel" :bordered="true">
      <template #title>
        <div class="test-panel-head">
          <span>试采结果</span>
          <a-tag color="blue" class="preview-badge">仅预览 · 未入库</a-tag>
        </div>
      </template>
      <template #extra>
        <a-button type="link" size="small" @click="runTest">重新测试</a-button>
      </template>

      <!-- 成功 -->
      <template v-if="testResult?.status === 'ok'">
        <div class="test-summary">
          试采到 <b>{{ testResult.items.length }}</b> 条（展示前 5 条）· 耗时 {{ testResult.duration_ms }} ms
        </div>
        <a-list :data-source="testResult.items" size="small" item-layout="vertical">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <a :href="item.url ?? undefined" target="_blank" rel="noopener">{{ item.title }}</a>
                </template>
                <template #description>
                  <span class="mono">{{ item.external_id }}</span>
                  <span class="dot">·</span>
                  {{ fmtDate(item.publish_date) }}
                  <span class="dot">·</span>
                  {{ item.source_name }}
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
        <div class="test-note">以上内容未写入采集明细，不影响真实采集记录与发布管线。</div>
      </template>

      <!-- 空结果 -->
      <a-result
        v-else-if="testResult?.status === 'empty'"
        status="info"
        title="试采返回空"
        sub-title="上游可能限流、网络不通或筛选条件过严。请检查 config 参数后重试；定时管线不受影响。"
      />

      <!-- 失败 -->
      <a-result
        v-else-if="testResult?.status === 'failed'"
        status="error"
        title="试采失败"
        :sub-title="testResult.error || '采集器抛异常，可查看技术详情'"
      >
        <template #extra>
          <a-button type="primary" size="small" @click="runTest">重新测试</a-button>
        </template>
      </a-result>
    </a-card>
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
.src-form {
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
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}
.test-panel {
  margin-top: 16px;
}
.test-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-badge {
  font-weight: 600;
}
.test-summary {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
.dot {
  margin: 0 6px;
  color: var(--text-faint);
}
.test-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}
</style>

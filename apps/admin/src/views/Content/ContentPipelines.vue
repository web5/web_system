<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import {
  listPipelines,
  deletePipeline,
  updatePipeline,
  runPipeline,
  getPipelineRunJob,
  type ContentPipeline,
  type PipelineRunJob,
} from '@/api/content';

const router = useRouter();
const userStore = useUserStore();
const canManage = userStore.hasPermission('content:manage');

const pipelines = ref<ContentPipeline[]>([]);
const loading = ref(false);
/** 正在运行的管线编码（按钮转圈 + 防重复点击） */
const runningCode = ref<string | null>(null);
/** 运行进度提示（"已运行 12s"），长任务不给反馈用户会以为卡死了 */
const runningTip = ref<string>('');
/** 组件卸载后停止轮询，避免在已销毁的组件上写 ref */
let pollCancelled = false;
onBeforeUnmount(() => {
  pollCancelled = true;
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function load() {
  loading.value = true;
  try {
    pipelines.value = await listPipelines();
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    loading.value = false;
  }
}

async function onDelete(p: ContentPipeline) {
  try {
    await deletePipeline(p.id);
    message.success('已删除');
    load();
  } catch {
    /* request 拦截器已弹错 */
  }
}

async function onToggle(p: ContentPipeline, checked: boolean) {
  try {
    await updatePipeline(p.id, { enabled: checked });
    message.success(checked ? '已启用' : '已停用');
    load();
  } catch {
    /* request 拦截器已弹错 */
  }
}

/**
 * 轮询一次运行结果，直到 status 不再是 running（或超过 maxMs）。
 *
 * 为什么轮询而不是干等：管线一次运行 30 秒起步，同步等会被链路超时掐断
 * （前端 10s / 网关 30s / nginx 60s），用户看到的是「网络错误」而后端其实还在跑。
 * 轮询的每个请求本身都是毫秒级的快查询，不存在超时问题。
 */
async function pollRunJob(jobId: number, maxMs = 180_000): Promise<PipelineRunJob | null> {
  const t0 = Date.now();
  while (!pollCancelled && Date.now() - t0 < maxMs) {
    await sleep(2000);
    if (pollCancelled) return null;
    const job = await getPipelineRunJob(jobId);
    if (job.status !== 'running') return job;
    runningTip.value = `已运行 ${Math.round((job.elapsed_ms ?? Date.now() - t0) / 1000)}s`;
  }
  // 超时：再取一次确认终态，仍 running 就如实告诉用户"还在跑"，不谎报成功也不谎报失败
  if (pollCancelled) return null;
  return await getPipelineRunJob(jobId);
}

/**
 * 立即运行一条管线（采集 → 成文 → 发布），异步执行 + 轮询取结果。
 *
 * 🔴 会真的往发布目标投递内容 —— 所以入口带二次确认，不做成点了就发的静默按钮。
 * 结果按「采集 / 新入库 / 发布 / 失败」四数回显，让"跑了但没数据"和"跑了且发出去了"能区分开。
 */
async function onRun(p: ContentPipeline) {
  if (runningCode.value) return;
  runningCode.value = p.code;
  runningTip.value = '已提交，等待执行…';
  try {
    const accepted = await runPipeline(p.code);
    if (accepted.reused) {
      message.info('该管线已有任务在跑，本次复用了它 —— 不会重复投递内容');
    }
    const job = await pollRunJob(accepted.job_id);
    if (!job) return;
    if (job.status === 'ok') {
      const sec = job.duration_ms ? `（${(job.duration_ms / 1000).toFixed(1)}s）` : '';
      message.success(
        `运行完成${sec}：采集 ${job.collected} · 新入库 ${job.new_items} · 发布 ${job.published} · 失败 ${job.errors}`,
      );
    } else if (job.status === 'failed') {
      message.error(`运行失败：${job.error_msg ?? '未知原因'}`);
    } else {
      message.warning(
        `仍在运行（已 ${Math.round((job.elapsed_ms ?? 0) / 1000)}s），后台会跑完 —— 稍后到「发布记录」看结果`,
      );
    }
  } catch {
    /* request 拦截器已弹错 */
  } finally {
    runningCode.value = null;
    runningTip.value = '';
  }
}

const PUBLISH_TARGET_LABEL: Record<string, string> = {
  tencent_docs: '腾讯文档',
  wechat_mp: '公众号',
};

const PUBLISH_MODE_LABEL: Record<string, string> = {
  publish: '直接发布',
  draft: '只建草稿',
};

const pipelineColumns = [
  { title: '编码', dataIndex: 'code', width: 130 },
  { title: '类型', dataIndex: 'type', width: 90 },
  { title: 'cron', dataIndex: 'cron', width: 120 },
  { title: '标题模板', dataIndex: 'title_template', ellipsis: true },
  { title: '发布目标', key: 'publish_targets', width: 170 },
  { title: '发布模式', key: 'publish_mode', width: 110 },
  { title: '状态', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 230 },
];

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>发布管线</h2>
      <div class="header-actions">
        <a-button v-if="canManage" type="primary" @click="router.push('/content/pipelines/new')">添加管线</a-button>
      </div>
    </div>

    <!-- 运行进度条：长任务没有反馈，用户会当成卡死 -->
    <a-alert v-if="runningCode" type="info" show-icon banner class="run-tip">
      <template #message>
        管线 <span class="mono">{{ runningCode }}</span> 正在后台执行 · {{ runningTip }}
      </template>
    </a-alert>

    <a-table
      :columns="pipelineColumns"
      :data-source="pipelines"
      :loading="loading"
      row-key="id"
      :pagination="false"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.dataIndex === 'type'">
          <a-tag :color="record.type === 'paper' ? 'purple' : 'green'">{{ record.type }}</a-tag>
        </template>
        <template v-else-if="column.dataIndex === 'cron'">
          <span class="mono">{{ record.cron }}</span>
        </template>
        <template v-else-if="column.key === 'publish_targets'">
          <a-space :size="4" wrap>
            <a-tag v-for="t in record.publish_targets ?? []" :key="t" color="geekblue">
              {{ PUBLISH_TARGET_LABEL[t] ?? t }}
            </a-tag>
          </a-space>
        </template>
        <template v-else-if="column.key === 'publish_mode'">
          <a-tag :color="record.publish_mode === 'draft' ? 'orange' : 'blue'">
            {{ PUBLISH_MODE_LABEL[record.publish_mode ?? 'publish'] ?? '直接发布' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'enabled'">
          <a-switch :checked="record.enabled" :disabled="!canManage" @change="(checked: boolean) => onToggle(record, checked)" />
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-popconfirm
              v-if="canManage"
              title="立即运行这条管线？会按发布目标真实投递内容（草稿或正式发布取决于该管线的发布模式）。"
              @confirm="onRun(record)"
            >
              <a-button
                size="small"
                type="primary"
                :loading="runningCode === record.code"
                :disabled="!!runningCode && runningCode !== record.code"
              >
                {{ runningCode === record.code ? '运行中…' : '立即运行' }}
              </a-button>
            </a-popconfirm>
            <a-button size="small" @click="router.push(`/content/pipelines/${record.id}`)">编辑</a-button>
            <a-popconfirm v-if="canManage" title="确定删除该管线？" @confirm="onDelete(record)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>
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
  gap: 12px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
.run-tip {
  margin-bottom: 12px;
}
</style>

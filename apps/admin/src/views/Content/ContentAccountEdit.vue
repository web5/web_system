<script setup lang="ts">
/**
 * 自媒体账号管理 · 新增 / 编辑（骨架，A12 / 2026-10-23）
 *
 * ⚠️ 本页是**骨架**：结构按
 *   - 规格：docs/ui/page-specs/content-accounts-v1.md 屏 2
 *   - 原型：docs/ui/prototypes/admin-media-ops.html 场景包 p17–p19
 * 落定，保存 / 检测 / 删除当前走临时提示，等后端接口落地后替换为真实调用（替换点就近标注）。
 */
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { message } from 'ant-design-vue';

const route = useRoute();
const router = useRouter();

const isNew = computed(() => route.name === 'ContentAccountCreate');
const accountId = computed(() => (isNew.value ? null : Number(route.params.id)));

/** 平台选项：只列已接入平台（腾讯文档 A5 已下线、小红书未接入 → 不出现） */
const PLATFORMS = [{ value: 'wechat_mp', label: '公众号' }];

const form = reactive({
  code: '',
  name: '',
  platform: 'wechat_mp',
  enabled: true,
  // 凭据：平台决定字段。已保存态后端只回掩码，重新录入时留空表示不修改
  app_id: '',
  app_secret: '',
  gh_id: '',
});

/** 已保存账号显示掩码；点「重新录入」切回输入框 */
const secretMasked = ref(false);
const secretMask = ref('');

const saving = ref(false);
const testing = ref(false);
const testResult = ref<
  | { ok: true; identity: string; capabilities: string[] }
  | { ok: false; code: string; message: string; suggestion: string }
  | null
>(null);

async function onSave() {
  if (!form.name.trim() || !form.code.trim()) {
    message.warning('名称与编码必填');
    return;
  }
  saving.value = true;
  try {
    // 后端接口落地后替换：isNew ? createAccount(dto) : updateAccount(id, dto)
    message.info('保存待后端接口落地');
  } finally {
    saving.value = false;
  }
}

async function onTest() {
  testing.value = true;
  testResult.value = null;
  try {
    // 后端接口落地后替换：POST .../accounts/test-preview（新建）/ .../accounts/:id/test（编辑）
    message.info('连通性检测待后端接口落地');
  } finally {
    testing.value = false;
  }
}

function onDelete() {
  // 后端接口落地后替换：DELETE .../accounts/:id；确认文案需含「管线引用此账号会发布失败」
  message.info('删除待后端接口落地');
}
</script>

<template>
  <div class="page">
    <div class="header">
      <h2>{{ isNew ? '新增账号' : `编辑账号 · ${form.name || accountId}` }}</h2>
    </div>

    <a-alert type="warning" show-icon class="acc-tip">
      <template #message>骨架页 · 后端接口建设中</template>
      <template #description>
        表单字段与权限已按原型 p17–p19 落定；<span class="mono">content_accounts</span> 表与
        CRUD / 连通性检测接口落地后即可保存，本条提示随之移除。
      </template>
    </a-alert>

    <!-- 基础信息 -->
    <a-card title="基础信息" class="acc-card">
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="名称">
            <a-input v-model:value="form.name" placeholder="大橙子社区" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="编码">
            <a-tooltip title="创建后不可改">
              <a-input v-model:value="form.code" :disabled="!isNew" placeholder="default" />
            </a-tooltip>
          </a-form-item>
        </a-col>
      </a-row>
      <a-row :gutter="16">
        <a-col :span="12">
          <a-form-item label="平台">
            <a-select v-model:value="form.platform" :options="PLATFORMS" />
          </a-form-item>
        </a-col>
        <a-col :span="12">
          <a-form-item label="启用">
            <a-switch v-model:checked="form.enabled" />
          </a-form-item>
        </a-col>
      </a-row>
    </a-card>

    <!-- 凭据：平台决定字段（公众号：AppID / AppSecret / GH_ID） -->
    <a-card title="凭据" class="acc-card">
      <template #extra>
        <a-button v-if="secretMasked" size="small" @click="secretMasked = false">重新录入</a-button>
      </template>
      <template v-if="form.platform === 'wechat_mp'">
        <a-form-item label="AppID">
          <a-input v-model:value="form.app_id" placeholder="wxc945245618618618707a06" class="mono" />
        </a-form-item>
        <a-form-item label="AppSecret">
          <a-input
            v-if="!secretMasked"
            v-model:value="form.app_secret"
            type="password"
            placeholder="留空表示不修改"
            class="mono"
          />
          <span v-else class="mono masked">{{ secretMask || 'wx****************************' }}</span>
        </a-form-item>
        <a-form-item label="GH_ID（原始 ID）">
          <a-input v-model:value="form.gh_id" placeholder="选填，部分接口需要" class="mono" />
        </a-form-item>
      </template>
    </a-card>

    <!-- 连通性 -->
    <a-card title="连通性" class="acc-card">
      <a-button :loading="testing" @click="onTest">测试连通性</a-button>
      <p v-if="!testResult" class="muted">保存前建议先测一次；结果含主体名、能力清单与处置建议</p>

      <a-alert v-else-if="testResult.ok" type="success" show-icon class="acc-tip">
        <template #message>连通正常 · {{ testResult.identity }}</template>
        <template #description>
          能力：{{ testResult.capabilities.join(' / ') }}
        </template>
      </a-alert>
      <a-alert v-else type="error" show-icon class="acc-tip">
        <template #message>检测失败 · {{ testResult.code }}</template>
        <template #description>
          <div>{{ testResult.message }}</div>
          <div>处置建议：{{ testResult.suggestion }}</div>
        </template>
      </a-alert>
    </a-card>

    <!-- 底部操作栏 -->
    <div class="footer">
      <a-popconfirm
        v-if="!isNew"
        title="删除账号？该账号的加密凭据会一并删除，且不可恢复；若仍有管线引用此账号，那些管线会发布失败。"
        @confirm="onDelete"
      >
        <a-button danger>删除</a-button>
      </a-popconfirm>
      <a-space>
        <a-button @click="router.push('/content/accounts')">取消</a-button>
        <a-button type="primary" :loading="saving" @click="onSave">保存</a-button>
      </a-space>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}
.header {
  margin-bottom: 16px;
}
.acc-tip {
  margin-bottom: 12px;
}
.acc-card {
  margin-bottom: 16px;
}
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
.masked {
  color: var(--text-tertiary);
}
.muted {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-faint);
}
.footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
}
</style>

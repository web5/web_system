<script setup lang="ts">
/**
 * 自媒体账号管理 · 账号列表（骨架，A12 / 2026-10-23）
 *
 * ⚠️ 本页是**骨架**：结构与交互按
 *   - 规格：docs/ui/page-specs/content-accounts-v1.md
 *   - 原型：docs/ui/prototypes/admin-media-ops.html 场景包 p11–p16
 * 落定，但数据暂为空数组（等后端接口），等后端 content_accounts 表 + CRUD 接口
 * 落地后把 load() 换成 @/api/content 的 listAccounts() 即可（替换点标注在 load 处）。
 *
 * 先落路由 + 菜单 + 骨架，是为了让整合稿 admin-agents-hub.html 的这一屏可达
 * （R9b：UI 改动须先出 Proto，Proto: ad909cac）。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import { useUserStore } from '@/stores/user';
import { listAccounts, testAccount, type ContentAccount } from '@/api/content';

const router = useRouter();
const userStore = useUserStore();
/** 写操作（新增/编辑/删除/检测/启停）收窄到 content:manage；查看只要 content:view */
const canManage = userStore.hasPermission('content:manage');

/** 平台 → 展示名。只列已接入平台（腾讯文档已下线、小红书未接入 → 不出现） */
const PLATFORM_LABEL: Record<string, string> = {
  wechat_mp: '公众号',
};

/** 连通性状态 → tag 色与文案 */
const CHECK_STATUS: Record<string, { color: string; label: string }> = {
  ok: { color: 'green', label: '正常' },
  warn: { color: 'orange', label: '权限不足' },
  err: { color: 'red', label: '失败' },
};

/**
 * 主体类型 → tag 与说明（2026-10-23）
 *
 * 这不是一个展示用的标签而已：它决定「公众号成文」里那条内容的状态流转。
 * 个人主体没有 freepublish 权限，草稿就是终点；企业主体才有「发布」这一步。
 * 类型标错，运营看到的就是错的下一步（天天点一个注定 48001 的按钮）。
 */
const ACCOUNT_TYPE: Record<string, { color: string; label: string; hint: string }> = {
  personal: { color: 'blue', label: '个人', hint: '无发布权限，草稿即完成' },
  enterprise: { color: 'green', label: '企业', hint: '可发布：待发布 → 已发布' },
};

// 账号行类型来自 @/api/content（接口只回掩码，密文不出后端）

// ── 列表 ──
const accounts = ref<ContentAccount[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// ── 筛选 ──
const filterPlatform = ref<string | undefined>(undefined);
const filterStatus = ref<string | undefined>(undefined);
const keyword = ref('');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    accounts.value = await listAccounts();
  } catch (e) {
    error.value = (e as Error)?.message || '请求失败';
  } finally {
    loading.value = false;
  }
}

const filtered = computed(() =>
  accounts.value.filter((a) => {
    if (filterPlatform.value && a.platform !== filterPlatform.value) return false;
    if (filterStatus.value) {
      const s = a.last_check_status ?? 'unknown';
      if (filterStatus.value === 'unchecked' ? s !== 'unknown' : s !== filterStatus.value) return false;
    }
    if (keyword.value && !`${a.name}${a.code}`.includes(keyword.value)) return false;
    return true;
  }),
);

function resetFilter() {
  filterPlatform.value = undefined;
  filterStatus.value = undefined;
  keyword.value = '';
}

// 后端接口落地后替换：PATCH .../accounts/:id/enabled
async function onToggle(a: ContentAccount, checked: boolean) {
  a.enabled = checked;
  message.success(checked ? '已启用' : '已停用');
}

// 连通性检测（2026-10-24 接入）：POST accounts/:id/test，结论回填本行
const checkingId = ref<number | null>(null);
async function onCheck(a: ContentAccount) {
  if (checkingId.value) return;
  checkingId.value = a.id;
  try {
    const r = await testAccount(a.id);
    a.last_check_status = r.status;
    a.last_checked_at = r.checked_at;
    if (r.status === 'ok') message.success(r.message);
    else if (r.status === 'warn') message.warning(r.message);
    else message.error(r.message);
  } catch (e) {
    message.error((e as Error)?.message || '检测请求失败');
  } finally {
    checkingId.value = null;
  }
}

// 后端接口落地后替换：DELETE .../accounts/:id
function onDelete(a: ContentAccount) {
  accounts.value = accounts.value.filter((x) => x.id !== a.id);
  message.success('已删除');
}

const fmtTime = (s?: string | null) => (s ? String(s).slice(5, 16).replace('T', ' ') : '');

const columns = [
  { title: '账号', key: 'account', width: 200 },
  { title: '平台', key: 'platform', width: 100 },
  { title: '主体类型', key: 'accountType', width: 160 },
  { title: '主体标识', key: 'identity', width: 200 },
  { title: '凭据', key: 'credentials', width: 200 },
  { title: '连通性', key: 'check', width: 180 },
  { title: '启用', key: 'enabled', width: 80 },
  { title: '操作', key: 'action', width: 180 },
];

onMounted(load);
</script>

<template>
  <!-- 不包 a-config-provider，避免覆盖 shell antd 的默认 token（cssinjs 类名 hash 会变） -->
  <div class="page">
    <div class="header">
      <h2>账号管理</h2>
      <div class="header-actions">
        <a-button @click="load">刷新</a-button>
        <a-button v-if="canManage" type="primary" @click="router.push('/content/accounts/new')">
          新增账号
        </a-button>
      </div>
    </div>

    <!-- 凭据加密说明条（A3 决议的用户可见面） -->
    <a-alert type="info" show-icon class="acc-tip">
      <template #message>凭据加密存储</template>
      <template #description>
        AppSecret 等以 AES-256-GCM 加密入库，列表与接口只返回掩码。解密钥由
        <span class="mono">ACCOUNT_CRED_KEY_FILE</span> 指向的 0600 文件提供，
        <b>不进进程环境变量</b>（避免 <span class="mono">pm2 env</span> 之类命令直接打出明文）。
      </template>
    </a-alert>

    <!-- 只读说明条：写操作接口落地后删除（连通性检测已于 2026-10-24 接入，从本条移除） -->
    <a-alert type="warning" show-icon class="acc-tip">
      <template #message>只读注册表 · 增删改待接入</template>
      <template #description>
        列表已接真实数据（<span class="mono">content_accounts</span> 表），连通性检测已接通。
        新增 / 编辑 / 删除接口落地前，账号的录入与变更走服务端 seed 脚本，本条提示随之移除。
      </template>
    </a-alert>

    <!-- 筛选条 -->
    <div class="filters">
      <a-select
        v-model:value="filterPlatform"
        allow-clear
        placeholder="平台"
        style="width: 140px"
        :options="Object.keys(PLATFORM_LABEL).map((v) => ({ value: v, label: PLATFORM_LABEL[v] }))"
      />
      <a-select
        v-model:value="filterStatus"
        allow-clear
        placeholder="连通性"
        style="width: 140px"
        :options="[
          { value: 'ok', label: '正常' },
          { value: 'warn', label: '权限不足' },
          { value: 'err', label: '失败' },
          { value: 'unchecked', label: '未检测' },
        ]"
      />
      <a-input v-model:value="keyword" allow-clear placeholder="名称 / 编码" style="width: 200px" />
      <a-button @click="resetFilter">重置</a-button>
    </div>

    <a-table
      :columns="columns"
      :data-source="filtered"
      :loading="loading"
      row-key="id"
      :pagination="false"
      size="middle"
      :locale="{ emptyText: ' ' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'account'">
          <div>{{ record.name }}</div>
          <div class="mono sub">{{ record.code }}</div>
        </template>
        <template v-else-if="column.key === 'platform'">
          <a-tag color="blue">{{ PLATFORM_LABEL[record.platform] ?? record.platform }}</a-tag>
        </template>
        <template v-else-if="column.key === 'accountType'">
          <template v-if="record.account_type">
            <a-tag :color="ACCOUNT_TYPE[record.account_type]?.color ?? 'default'">
              {{ ACCOUNT_TYPE[record.account_type]?.label ?? record.account_type }}
            </a-tag>
            <div class="sub">{{ ACCOUNT_TYPE[record.account_type]?.hint ?? '' }}</div>
          </template>
          <span v-else class="muted">未设置</span>
        </template>
        <template v-else-if="column.key === 'identity'">
          <span class="mono">{{ record.identity || '-' }}</span>
        </template>
        <template v-else-if="column.key === 'credentials'">
          <span class="mono">{{ record.credentials_mask || '-' }}</span>
          <a-tag v-if="record.credentials_mask" color="green" class="sub">已加密</a-tag>
        </template>
        <template v-else-if="column.key === 'check'">
          <template v-if="record.last_check_status">
            <a-tag :color="CHECK_STATUS[record.last_check_status]?.color ?? 'default'">
              {{ CHECK_STATUS[record.last_check_status]?.label ?? record.last_check_status }}
            </a-tag>
            <div class="sub">{{ fmtTime(record.last_checked_at) }}</div>
          </template>
          <span v-else class="muted">未检测</span>
        </template>
        <template v-else-if="column.key === 'enabled'">
          <a-switch
            :checked="record.enabled"
            :disabled="!canManage"
            @change="(checked: boolean) => onToggle(record, checked)"
          />
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-button
              v-if="canManage"
              size="small"
              :loading="checkingId === record.id"
              @click="onCheck(record)"
            >
              检测
            </a-button>
            <a-button size="small" @click="router.push(`/content/accounts/${record.id}`)">编辑</a-button>
            <a-popconfirm
              v-if="canManage"
              title="删除账号？该账号的加密凭据会一并删除，且不可恢复。"
              @confirm="onDelete(record)"
            >
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 空态（原型 p12）/ 失败可重试（p14） -->
    <a-empty
      v-if="!loading && !error && filtered.length === 0"
      description="还没有登记任何账号"
      class="acc-empty"
    >
      <a-button v-if="canManage" type="primary" @click="router.push('/content/accounts/new')">
        新增账号
      </a-button>
    </a-empty>

    <a-result
      v-if="error"
      status="error"
      title="请求失败"
      :sub-title="error"
    >
      <template #extra>
        <a-button type="primary" @click="load">重试</a-button>
      </template>
    </a-result>
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
.acc-tip {
  margin-bottom: 12px;
}
.filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.mono {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: 12px;
}
.sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.muted {
  color: var(--text-faint);
  font-size: 12px;
}
.acc-empty {
  padding: 32px 0;
}
</style>

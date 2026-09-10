<template>
  <a-page-header
    title="角色权限"
    sub-title="配置角色可访问的菜单与操作权限（admin 角色自动拥有全部权限）"
  >
    <template #extra>
      <a-button type="primary" @click="openCreate">新建角色</a-button>
      <a-tooltip title="以代码声明（packages/types）为准同步权限点；会覆盖内置角色权限">
        <a-button :loading="syncing" @click="confirmSync">同步权限点</a-button>
      </a-tooltip>
      <a-button :loading="loading" @click="reload">刷新</a-button>
    </template>
  </a-page-header>

  <!-- 未同步提示：代码声明与数据库不一致时出现（"接口通但菜单不出现"的根因就是它） -->
  <a-alert v-if="diff?.hasDiff" type="warning" show-icon class="sync-alert">
    <template #message>检测到权限点与代码声明不一致（未同步）</template>
    <template #description>
      <div v-if="diff.permissionsMissingInDb.length" class="diff-line">
        代码有、数据库缺失 {{ diff.permissionsMissingInDb.length }} 个：
        <span class="diff-codes">{{ preview(diff.permissionsMissingInDb) }}</span>
      </div>
      <div v-if="diff.permissionsExtraInDb.length" class="diff-line">
        数据库有、代码已移除 {{ diff.permissionsExtraInDb.length }} 个：
        <span class="diff-codes">{{ preview(diff.permissionsExtraInDb) }}</span>
      </div>
      <div v-for="r in diff.roles" :key="r.code" class="diff-line">
        内置角色 {{ r.code }}：缺 {{ r.missingInDb.length }} 个、多 {{ r.extraInDb.length }} 个
      </div>
    </template>
    <template #action>
      <a-button size="small" type="primary" :loading="syncing" @click="confirmSync">
        立即同步
      </a-button>
    </template>
  </a-alert>

  <a-row :gutter="16">
    <!-- 左：角色列表 -->
    <a-col :xs="24" :md="8" :lg="6">
      <a-card :bordered="true" title="角色列表" size="small">
        <div
          v-for="r in roles"
          :key="r.code"
          class="role-item"
          :class="{ active: current?.code === r.code }"
          @click="selectRole(r)"
        >
          <div class="role-item-head">
            <span class="role-name">{{ r.name }}</span>
            <a-tag v-if="r.isSystem" color="orange" size="small">内置</a-tag>
          </div>
          <div class="role-desc">{{ r.description || r.code }}</div>
        </div>
        <a-empty v-if="!loading && !roles.length" description="暂无角色" :image="null" />
      </a-card>
    </a-col>

    <!-- 右：权限配置 -->
    <a-col :xs="24" :md="16" :lg="18">
      <a-card v-if="current" :bordered="true" size="small">
        <template #title>
          <a-space>
            <span>权限配置 · {{ current.name }}</span>
            <a-tag v-if="current.isSystem" color="orange">内置角色权限以代码为准，仍可调整</a-tag>
          </a-space>
        </template>

        <a-spin :spinning="permLoading">
          <div v-for="g in permissionGroups" :key="g.group" class="perm-group">
            <div class="perm-group-title">
              {{ groupLabel(g.group) }}
              <span class="perm-count">{{ checkedInGroup(g.group) }}/{{ g.permissions.length }}</span>
            </div>
            <div class="perm-grid">
              <label
                v-for="p in g.permissions"
                :key="p.code"
                class="perm-item"
                :class="{ checked: checkedPerms.includes(p.code) }"
              >
                <a-checkbox v-model:checked="checkedSet[p.code]" :disabled="saving">
                  <span class="perm-name">{{ p.name }}</span>
                  <a-tag class="perm-code" size="small" color="default">{{ p.code }}</a-tag>
                  <a-tag v-if="p.type === 'menu'" size="small" color="blue">菜单</a-tag>
                  <a-tag v-else size="small">操作</a-tag>
                </a-checkbox>
              </label>
            </div>
          </div>

          <div class="perm-actions">
            <a-button @click="resetChecked" :disabled="saving">重置</a-button>
            <a-button type="primary" :loading="saving" @click="save">保存权限</a-button>
          </div>
        </a-spin>
      </a-card>
      <a-empty v-else description="请选择左侧角色进行权限配置" />
    </a-col>
  </a-row>

  <!-- 新建角色弹窗 -->
  <a-modal
    :open="createOpen"
    title="新建角色"
    :confirm-loading="creating"
    ok-text="创建"
    cancel-text="取消"
    @ok="createRole"
    @cancel="createOpen = false"
  >
    <a-form layout="vertical">
      <a-form-item label="角色 Code（唯一，小写短横线）" required>
        <a-input v-model:value="createForm.code" placeholder="如 operator" />
      </a-form-item>
      <a-form-item label="角色名" required>
        <a-input v-model:value="createForm.name" placeholder="如 运营专员" />
      </a-form-item>
      <a-form-item label="描述">
        <a-input v-model:value="createForm.description" placeholder="选填" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  listRoles,
  listPermissions,
  createRole as createRoleApi,
  updateRole,
  deleteRole,
  syncPermissions,
  getPermissionDiff,
  type RoleItem,
  type PermissionGroup,
  type PermissionDiff,
} from '@/api/permissions';
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
const syncing = ref(false);
const loading = ref(false);
const permLoading = ref(false);
const saving = ref(false);
const roles = ref<RoleItem[]>([]);
const permissionGroups = ref<PermissionGroup[]>([]);
const current = ref<RoleItem | null>(null);
/** 代码声明 vs DB 的差异（hasDiff 时页面顶部提示） */
const diff = ref<PermissionDiff | null>(null);

/** 当前角色的勾选状态（权限码 → boolean），随 current 切换重建 */
const checkedSet = reactive<Record<string, boolean>>({});
const checkedPerms = computed(() => Object.keys(checkedSet).filter((c) => checkedSet[c]));

const createOpen = ref(false);
const creating = ref(false);
const createForm = reactive({ code: '', name: '', description: '' });

const GROUP_LABELS: Record<string, string> = {
  dashboard: '工作台',
  users: '用户管理',
  settings: '系统设置',
  logs: '日志',
  mcp: 'MCP',
  agents: 'Agents',
  database: '数据浏览',
  knowledge: '知识库',
};

function groupLabel(g: string): string {
  return GROUP_LABELS[g] || g;
}

/**
 * 同步权限点：解决"新权限码只进了代码常量、没进 DB"导致菜单不出现的问题。
 * 同步后立即刷新自身权限，让新菜单当场出现，不必重登。
 */
function confirmSync(): void {
  Modal.confirm({
    title: '同步权限点？',
    content:
      '将以代码声明（packages/types）为准：补齐新增权限点，并按 ROLE_PERMISSIONS 全量覆盖内置角色（admin / editor / viewer）的权限。自定义角色不受影响。',
    okText: '确认同步',
    cancelText: '取消',
    onOk: async () => {
      syncing.value = true;
      try {
        const r = await syncPermissions();
        message.success(
          `同步完成：新增权限点 ${r.permissionsAdded} 个、更新 ${r.permissionsUpdated} 个、覆盖角色权限 ${r.rolePermissionsCovered} 条`,
        );
        await userStore.fetchPermissions();
        await reload();
      } catch (e) {
        message.error((e as Error).message || '同步失败');
      } finally {
        syncing.value = false;
      }
    },
  });
}
/** 差异列表预览：最多列 max 个，其余折叠为「等 N 个」 */
function preview(list: string[], max = 6): string {
  if (!list.length) return '—';
  return list.length <= max
    ? list.join('、')
    : `${list.slice(0, max).join('、')} 等 ${list.length} 个`;
}

function checkedInGroup(group: string): number {
  const g = permissionGroups.value.find((x) => x.group === group);
  if (!g) return 0;
  return g.permissions.filter((p) => checkedSet[p.code]).length;
}

function selectRole(r: RoleItem) {
  current.value = r;
  rebuildChecked(r);
}
function rebuildChecked(r: RoleItem) {
  for (const k of Object.keys(checkedSet)) delete checkedSet[k];
  for (const p of r.permissions || []) checkedSet[p] = true;
}
function resetChecked() {
  if (current.value) rebuildChecked(current.value);
}

async function reload() {
  loading.value = true;
  try {
    const [r, p, d] = await Promise.all([
      listRoles(),
      listPermissions(),
      // 差异是"锦上添花"的提示，拉取失败不该让整页报错
      getPermissionDiff().catch(() => null),
    ]);
    roles.value = (r || []) as RoleItem[];
    permissionGroups.value = (p || []) as PermissionGroup[];
    diff.value = d;
    if (current.value) {
      const fresh = roles.value.find((x) => x.code === current.value?.code);
      if (fresh) selectRole(fresh);
    }
  } catch (e: any) {
    message.error(e?.response?.data?.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!current.value) return;
  saving.value = true;
  try {
    await updateRole(current.value.code, {
      name: current.value.name,
      description: current.value.description,
      permissions: checkedPerms.value,
    });
    message.success('权限已保存，约 60s 内全局生效');
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

function openCreate() {
  createForm.code = '';
  createForm.name = '';
  createForm.description = '';
  createOpen.value = true;
}

async function createRole() {
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(createForm.code.trim())) {
    message.warning('角色 Code 需为小写字母开头的短横线/下划线标识符');
    return;
  }
  if (!createForm.name.trim()) {
    message.warning('角色名必填');
    return;
  }
  creating.value = true;
  try {
    await createRoleApi({
      code: createForm.code.trim(),
      name: createForm.name.trim(),
      description: createForm.description.trim() || null,
      permissions: [],
    });
    message.success('角色已创建，请勾选权限');
    createOpen.value = false;
    await reload();
  } catch (e: any) {
    message.error(e?.response?.data?.message || '创建失败');
  } finally {
    creating.value = false;
  }
}

onMounted(reload);
</script>

<style scoped>
.sync-alert {
  margin-bottom: 16px;
}
.diff-line {
  font-size: 12px;
  line-height: 1.8;
}
.diff-codes {
  font-family: monospace;
}
.role-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 6px;
  transition: all .2s;
}
.role-item:hover {
  background: rgba(255, 140, 66, .06);
}
.role-item.active {
  background: rgba(255, 140, 66, .10);
  border-color: rgba(255, 140, 66, .4);
}
.role-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.role-name {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}
.role-desc {
  font-size: 12px;
  color: #999;
  margin-top: 2px;
}
.perm-group {
  margin-bottom: 20px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  padding: 12px 16px;
}
.perm-group-title {
  font-size: 14px;
  font-weight: 600;
  color: #333;
  padding-bottom: 8px;
  border-bottom: 1px dashed #eee;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.perm-count {
  font-size: 12px;
  font-weight: 400;
  color: #999;
}
.perm-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}
.perm-item {
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #f0f0f0;
  cursor: pointer;
  transition: all .2s;
}
.perm-item.checked {
  background: rgba(22, 119, 255, .04);
  border-color: #91caff;
}
.perm-name {
  margin-left: 4px;
}
.perm-code {
  margin-left: 6px;
  font-family: monospace;
  font-size: 11px;
}
.perm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
}
</style>

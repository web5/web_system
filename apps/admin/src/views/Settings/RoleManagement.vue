<template>
  <a-page-header
    title="角色权限"
    sub-title="配置角色可访问的菜单与操作权限（admin 角色自动拥有全部权限）"
  >
    <template #extra>
      <a-button type="primary" @click="openCreate">新建角色</a-button>
      <a-button :loading="loading" @click="reload">刷新</a-button>
    </template>
  </a-page-header>

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
import { message } from 'ant-design-vue';
import {
  listRoles,
  listPermissions,
  createRole as createRoleApi,
  updateRole,
  deleteRole,
  type RoleItem,
  type PermissionGroup,
} from '@/api/permissions';

const loading = ref(false);
const permLoading = ref(false);
const saving = ref(false);
const roles = ref<RoleItem[]>([]);
const permissionGroups = ref<PermissionGroup[]>([]);
const current = ref<RoleItem | null>(null);

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
};

function groupLabel(g: string): string {
  return GROUP_LABELS[g] || g;
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
    const [r, p] = await Promise.all([listRoles(), listPermissions()]);
    roles.value = (r || []) as RoleItem[];
    permissionGroups.value = (p || []) as PermissionGroup[];
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

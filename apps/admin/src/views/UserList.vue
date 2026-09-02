<template>
  <div class="user-list-page">
    <!-- 页头 -->
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">用户管理</h1>
        <p class="page-subtitle">管理系统所有注册用户，支持查看、编辑、启停等操作</p>
      </div>
      <a-button type="primary" size="large" @click="showAddModal">
        <template #icon><PlusOutlined /></template>
        新增用户
      </a-button>
    </div>

    <!-- 统计卡片 -->
    <a-row :gutter="16" class="stats-row">
      <a-col :span="8">
        <div class="mini-stat">
          <div class="mini-stat-icon"><TeamOutlined /></div>
          <div class="mini-stat-info">
            <span class="mini-stat-value">{{ pagination.total }}</span>
            <span class="mini-stat-label">用户总数</span>
          </div>
        </div>
      </a-col>
      <a-col :span="8">
        <div class="mini-stat">
          <div class="mini-stat-icon admin-icon"><SafetyOutlined /></div>
          <div class="mini-stat-info">
            <span class="mini-stat-value">{{ adminCount }}</span>
            <span class="mini-stat-label">管理员</span>
          </div>
        </div>
      </a-col>
      <a-col :span="8">
        <div class="mini-stat">
          <div class="mini-stat-icon active-icon"><CheckCircleOutlined /></div>
          <div class="mini-stat-info">
            <span class="mini-stat-value">{{ activeCount }}</span>
            <span class="mini-stat-label">已启用</span>
          </div>
        </div>
      </a-col>
    </a-row>

    <!-- 搜索 & 工具栏 -->
    <div class="toolbar-card">
      <a-input-search
        v-model:value="searchText"
        placeholder="搜索用户名、邮箱或手机号..."
        class="search-input"
        @search="handleSearch"
        allow-clear
      >
        <template #prefix><SearchOutlined class="search-icon" /></template>
      </a-input-search>
      <div class="toolbar-actions">
        <a-tooltip title="刷新">
          <a-button shape="circle" @click="fetchUsers" :loading="loading">
            <template #icon><ReloadOutlined /></template>
          </a-button>
        </a-tooltip>
      </div>
    </div>

    <!-- 用户表格 -->
    <div class="table-card">
      <a-table
        :columns="columns"
        :data-source="userList"
        :loading="loading"
        :pagination="pagination"
        @change="handleTableChange"
        row-key="id"
        :scroll="{ x: 900 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'avatar'">
            <a-avatar :size="40" :src="record.avatar">
              <template #icon><UserOutlined /></template>
            </a-avatar>
          </template>
          <template v-if="column.key === 'username'">
            <div class="user-cell">
              <span class="user-name">{{ record.username }}</span>
              <span v-if="record.nickname" class="user-nickname">{{ record.nickname }}</span>
            </div>
          </template>
          <template v-if="column.key === 'role'">
            <a-tag :color="roleTagColor(record.role)">
              {{ roleLabel(record.role) }}
            </a-tag>
          </template>
          <template v-if="column.key === 'status'">
            <a-badge :status="record.enabled ? 'success' : 'default'" />
            <span class="status-text">{{ record.enabled ? '已启用' : '已禁用' }}</span>
          </template>
          <template v-if="column.key === 'createdAt'">
            <span class="time-text">{{ formatDate(record.createdAt) }}</span>
          </template>
          <template v-if="column.key === 'action'">
            <a-space :size="2">
              <a-button type="link" size="small" @click="viewUser(record)">查看</a-button>
              <a-button type="link" size="small" @click="editUser(record)">编辑</a-button>
              <a-dropdown placement="bottomRight" :trigger="['click']">
                <a-button type="link" size="small">
                  <template #icon><MoreOutlined /></template>
                </a-button>
                <template #overlay>
                  <a-menu @click="({ key }: any) => handleMenuAction(key, record)">
                    <a-menu-item key="quota">
                      <SettingOutlined />
                      <span class="menu-item-text">配额设置</span>
                    </a-menu-item>
                    <a-menu-item
                      key="toggle"
                      :disabled="record.role === 'admin'"
                    >
                      <PauseCircleOutlined v-if="record.enabled" />
                      <PlayCircleOutlined v-else />
                      <span class="menu-item-text">{{ record.enabled ? '禁用' : '启用' }}</span>
                    </a-menu-item>
                    <a-menu-divider />
                    <a-menu-item key="delete" danger :disabled="record.role === 'admin'">
                      <DeleteOutlined />
                      <span class="menu-item-text">删除</span>
                    </a-menu-item>
                  </a-menu>
                </template>
              </a-dropdown>
            </a-space>
          </template>
        </template>
      </a-table>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <a-modal
      v-model:open="modalVisible"
      :title="null"
      :footer="null"
      width="520px"
      :destroy-on-close="true"
      @cancel="modalVisible = false"
    >
      <template #closeIcon>
        <a-button type="text" shape="circle">
          <template #icon><CloseOutlined /></template>
        </a-button>
      </template>
      <div class="modal-header">
        <div class="modal-icon-wrap">
          <UserAddOutlined v-if="!editingId" />
          <EditOutlined v-else />
        </div>
        <h3 class="modal-title">{{ modalTitle }}</h3>
      </div>
      <a-form
        :model="formData"
        :label-col="{ span: 5 }"
        :wrapper-col="{ span: 19 }"
        class="user-form"
        @finish="handleModalOk"
      >
        <a-form-item label="用户名" name="username" :rules="[{ required: true, message: '请输入用户名' }]">
          <a-input v-model:value="formData.username" placeholder="请输入用户名" size="large" />
        </a-form-item>
        <a-form-item label="昵称" name="nickname">
          <a-input v-model:value="formData.nickname" placeholder="请输入昵称" size="large" />
        </a-form-item>
        <a-form-item label="邮箱" name="email">
          <a-input v-model:value="formData.email" placeholder="请输入邮箱" size="large" />
        </a-form-item>
        <a-form-item label="手机号" name="phone">
          <a-input v-model:value="formData.phone" placeholder="请输入手机号" size="large" />
        </a-form-item>
        <a-form-item label="角色" name="role">
          <a-select v-model:value="formData.role" size="large">
            <a-select-option value="admin">管理员</a-select-option>
            <a-select-option value="editor">编辑</a-select-option>
            <a-select-option value="viewer">只读</a-select-option>
            <a-select-option value="user">普通用户</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="状态" name="enabled">
          <a-switch v-model:checked="formData.enabled" size="small" />
          <span class="form-switch-label">{{ formData.enabled ? '启用' : '禁用' }}</span>
        </a-form-item>
        <div class="modal-footer">
          <a-button @click="modalVisible = false" size="large">取消</a-button>
          <a-button type="primary" html-type="submit" size="large" :loading="submitting">
            {{ editingId ? '保存修改' : '确认创建' }}
          </a-button>
        </div>
      </a-form>
    </a-modal>

    <!-- 设置配额弹窗 -->
    <a-modal
      v-model:open="quotaVisible"
      title="设置变变使用配额"
      width="420px"
      :confirm-loading="quotaLoading"
      @ok="saveQuota"
      @cancel="quotaVisible = false"
    >
      <p>用户：{{ quotaRecord?.username }}</p>
      <a-form layout="vertical">
        <a-form-item label="每日变身次数限制">
          <a-input-number
            v-model:value="quotaValue"
            :min="0"
            style="width: 100%"
            placeholder="留空表示使用全局默认"
          />
        </a-form-item>
      </a-form>
      <template #footer>
        <a-button @click="quotaVisible = false">取消</a-button>
        <a-button type="primary" :loading="quotaLoading" @click="saveQuota">保存</a-button>
      </template>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import {
  PlusOutlined, TeamOutlined, SafetyOutlined, CheckCircleOutlined,
  SearchOutlined, ReloadOutlined, UserOutlined,
  EditOutlined, PauseCircleOutlined, PlayCircleOutlined,
  DeleteOutlined, CloseOutlined, UserAddOutlined, SettingOutlined,
  MoreOutlined,
} from '@ant-design/icons-vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import { message, Modal } from 'ant-design-vue';
import { getUserList, createUser, updateUser, deleteUser, toggleUserStatus as toggleUserStatusApi } from '@/api/user';
import dayjs from 'dayjs';

const router = useRouter();

interface User {
  id: number | string;
  username: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatar?: string;
  gender?: 'male' | 'female' | 'unknown';
  role: string;
  enabled: boolean;
  dailyTransformLimit?: number | null;
  createdAt: string;
}

const loading = ref(false);
const submitting = ref(false);
const userList = ref<User[]>([]);
const searchText = ref('');
const modalVisible = ref(false);
const modalTitle = ref('新增用户');
const editingId = ref<string | number | null>(null);
const quotaVisible = ref(false);
const quotaLoading = ref(false);
const quotaRecord = ref<User | null>(null);
const quotaValue = ref<number | null>(null);

function defaultAvatar(gender?: string) {
  return gender === 'female' ? '/avatars/default-female.png' : '/avatars/default-male.png';
}

const formData = reactive<any>({
  username: '',
  email: '',
  phone: '',
  nickname: '',
  role: 'user',
  enabled: true,
});

const adminCount = computed(() => userList.value.filter(u => u.role === 'admin').length);
const activeCount = computed(() => userList.value.filter(u => u.enabled).length);

const columns = [
  { title: '', dataIndex: 'avatar', key: 'avatar', width: 64 },
  { title: '用户', dataIndex: 'username', key: 'username', width: 160 },
  { title: '邮箱', dataIndex: 'email', key: 'email', ellipsis: true },
  { title: '手机号', dataIndex: 'phone', key: 'phone', width: 140 },
  { title: '角色', dataIndex: 'role', key: 'role', width: 90 },
  { title: '状态', dataIndex: 'enabled', key: 'status', width: 90 },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 120 },
  { title: '操作', key: 'action', width: 180, fixed: 'right' as const },
];

const pagination = reactive<TablePaginationConfig>({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条`,
});

function roleTagColor(role: string) {
  switch (role) {
    case 'admin': return 'orange';
    case 'editor': return 'blue';
    case 'viewer': return 'cyan';
    default: return 'default';
  }
}

function roleLabel(role: string) {
  switch (role) {
    case 'admin': return '管理员';
    case 'editor': return '编辑';
    case 'viewer': return '只读';
    default: return '普通用户';
  }
}

/** 从 roles 数组解析页面展示用的主角色（优先级 admin > editor > viewer > user） */
function pickRole(roles: string[]): string {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('editor')) return 'editor';
  if (roles.includes('viewer')) return 'viewer';
  return roles.includes('user') ? 'user' : 'user';
}

function formatDate(d: string) {
  if (!d) return '-';
  return dayjs(d).format('YYYY-MM-DD HH:mm');
}

onMounted(() => {
  fetchUsers();
});

async function fetchUsers() {
  loading.value = true;
  try {
    const res = await getUserList({
      page: pagination.current,
      limit: pagination.pageSize,
      keyword: searchText.value || undefined,
    });
    // 后端经全局 TransformInterceptor 包裹为 { code, data, message }，这里解包出 data
    const data = (res && (res as any).data) ? (res as any).data : (res as any);
    const list = data?.list || [];
    userList.value = list.map((user: any) => ({
      ...user,
      avatar: user.avatar || defaultAvatar(user.gender),
      // 后端角色是 roles 数组、状态是 status 字符串，这里映射为页面用的 role/enabled
      role: pickRole(Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : [])),
      enabled: user.enabled !== undefined ? user.enabled : (user.status ? user.status === 'active' : true),
      createdAt: user.createdAt || '',
    }));
    pagination.total = data?.total || 0;
  } catch {
    userList.value = [];
    pagination.total = 0;
  } finally {
    loading.value = false;
  }
}

function handleTableChange(pag: TablePaginationConfig) {
  pagination.current = pag.current;
  pagination.pageSize = pag.pageSize;
  fetchUsers();
}

function handleSearch() {
  pagination.current = 1;
  fetchUsers();
}

function showAddModal() {
  modalTitle.value = '新增用户';
  editingId.value = null;
  Object.assign(formData, {
    username: '', email: '', phone: '', nickname: '', role: 'user', enabled: true,
  });
  modalVisible.value = true;
}

function viewUser(record: User) {
  router.push(`/users/${record.id}`);
}

function openQuotaModal(record: User) {
  quotaRecord.value = record;
  quotaValue.value = (record as any).dailyTransformLimit ?? null;
  quotaVisible.value = true;
}

async function saveQuota() {
  if (!quotaRecord.value) return;
  quotaLoading.value = true;
  try {
    await updateUser(String(quotaRecord.value.id), { dailyTransformLimit: quotaValue.value });
    message.success('配额设置成功');
    quotaVisible.value = false;
    fetchUsers();
  } catch {
    message.error('配额设置失败');
  } finally {
    quotaLoading.value = false;
  }
}

function editUser(record: User) {
  modalTitle.value = '编辑用户';
  editingId.value = record.id;
  Object.assign(formData, record);
  modalVisible.value = true;
}

async function handleModalOk() {
  submitting.value = true;
  try {
    // 页面用 role 单选，后端用 roles 数组（whitelist 只认 roles）
    const userData = { ...formData } as any;
    userData.roles = formData.role ? [formData.role] : ['user'];
    delete userData.role;
    if (editingId.value) {
      await updateUser(String(editingId.value), userData);
      message.success('更新成功');
    } else {
      await createUser(userData);
      message.success('创建成功');
    }
    modalVisible.value = false;
    fetchUsers();
  } catch {
    message.error('操作失败');
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(record: User) {
  try {
    await deleteUser(String(record.id));
    message.success('删除成功');
    fetchUsers();
  } catch {
    message.error('删除失败');
  }
}

async function toggleStat(record: User) {
  const next = !record.enabled;
  try {
    await toggleUserStatusApi(String(record.id), next);
    record.enabled = next;
    message.success(next ? '已启用' : '已禁用');
  } catch {
    message.error('操作失败');
  }
}

function handleMenuAction(key: string, record: User) {
  switch (key) {
    case 'quota':
      openQuotaModal(record);
      break;
    case 'toggle':
      toggleStat(record);
      break;
    case 'delete':
      Modal.confirm({
        title: '确定要删除该用户吗？',
        content: '删除后数据将不可恢复',
        okText: '确定删除',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: () => handleDelete(record),
      });
      break;
  }
}
</script>

<style scoped>
.user-list-page {
  padding: 8px 0;
}

/* 页头 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}
.page-header-left { flex: 1; }
.page-title {
  margin: 0; font-size: 22px; font-weight: 700; color: var(--text-heading); letter-spacing: -.3px;
}
.page-subtitle {
  margin: 4px 0 0; font-size: 13px; color: var(--text-muted);
}

/* 统计卡片 */
.stats-row {
  margin-bottom: 16px;
}
.mini-stat {
  display: flex; align-items: center; gap: 14px;
  padding: 16px 20px; border-radius: 4px;
  background: linear-gradient(135deg, rgba(255,140,66,.06) 0%, rgba(255,140,66,.02) 100%);
  border: 1px solid rgba(255,140,66,.08);
  transition: all .25s;
}
.mini-stat:hover {
  background: linear-gradient(135deg, rgba(255,140,66,.1) 0%, rgba(255,140,66,.04) 100%);
  border-color: rgba(255,140,66,.2);
  transform: translateY(-1px);
}
.mini-stat-icon {
  width: 42px; height: 42px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; color: #FF8C42; background: rgba(255,140,66,.12);
  flex-shrink: 0;
}
.mini-stat-icon.admin-icon { color: #E2B93B; background: rgba(226,185,59,.12); }
.mini-stat-icon.active-icon { color: #22C55E; background: rgba(34,197,94,.12); }
.mini-stat-info {
  display: flex; flex-direction: column;
}
.mini-stat-value {
  font-size: 22px; font-weight: 700; color: var(--text-heading); line-height: 1.2;
}
.mini-stat-label {
  font-size: 12px; color: var(--text-muted); margin-top: 2px;
}

/* 工具栏 */
.toolbar-card {
  display: flex; align-items: center; gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  background: linear-gradient(135deg, var(--card-bg-start) 0%, var(--card-bg-end) 100%);
  border: 1px solid var(--card-border);
  border-radius: 4px;
}
.search-input {
  max-width: 360px;
}
.search-input :deep(.ant-input) {
  background: var(--input-bg); border-color: var(--input-border);
  color: var(--input-text);
}
.search-input :deep(.ant-input::placeholder) { color: var(--input-placeholder); }
.search-input :deep(.ant-input-affix-wrapper) {
  background: var(--input-bg); border-color: var(--input-border); border-radius: 4px;
}
.search-input :deep(.ant-input-affix-wrapper:hover),
.search-input :deep(.ant-input-affix-wrapper:focus),
.search-input :deep(.ant-input-affix-wrapper-focused) {
  border-color: rgba(255,140,66,.4); box-shadow: 0 0 0 2px rgba(255,140,66,.12);
}
.search-icon { color: var(--text-muted); }
.toolbar-actions { margin-left: auto; }

/* 表格区域 */
.table-card {
  background: linear-gradient(135deg, var(--card-bg-start) 0%, var(--card-bg-end) 100%);
  border: 1px solid var(--card-border); border-radius: 4px;
  padding: 8px;
  overflow: hidden;
}
.table-card :deep(.ant-table) {
  background: transparent; color: var(--text-body);
}
.table-card :deep(.ant-table-thead > tr > th) {
  background: var(--table-header-bg); color: var(--table-header-text);
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px;
  border-bottom: 1px solid var(--border-light); padding: 12px 16px;
}
.table-card :deep(.ant-table-tbody > tr > td) {
  border-bottom: 1px solid var(--border-lighter); padding: 10px 16px;
}
.table-card :deep(.ant-table-tbody > tr:hover > td) {
  background: var(--table-hover-bg) !important;
}
.table-card :deep(.ant-table-tbody > tr:last-child > td) {
  border-bottom: none;
}
.table-card :deep(.ant-pagination) {
  margin: 16px 0 4px !important;
}
.table-card :deep(.ant-pagination-item-active) {
  border-color: #FF8C42;
}
.table-card :deep(.ant-pagination-item-active a) { color: #FF8C42; }

/* 用户列 */
.user-cell {
  display: flex; flex-direction: column;
}
.user-name { font-weight: 600; color: var(--text-heading); font-size: 14px; }
.user-nickname { font-size: 12px; color: var(--text-muted); margin-top: 1px; }

.status-text { margin-left: 6px; font-size: 13px; color: var(--text-tertiary); }
.time-text { font-size: 13px; color: var(--text-tertiary); white-space: nowrap; }

/* 弹窗 */
.modal-header {
  text-align: center; margin-bottom: 28px; padding-top: 8px;
}
.modal-icon-wrap {
  width: 56px; height: 56px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 24px; color: #FF8C42;
  background: linear-gradient(135deg, rgba(255,140,66,.15), rgba(255,140,66,.06));
  margin: 0 auto 14px;
}
.modal-title {
  margin: 0; font-size: 18px; font-weight: 700; color: var(--modal-title);
}
.user-form { padding: 0 8px; }

.form-switch-label {
  margin-left: 10px; font-size: 13px; color: var(--text-muted);
}
.modal-footer {
  display: flex; justify-content: flex-end; gap: 12px;
  margin-top: 8px; padding-top: 16px;
  border-top: 1px solid var(--border-divider);
}

.menu-item-text { margin-left: 6px; }
</style>

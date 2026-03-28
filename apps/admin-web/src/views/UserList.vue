<template>
  <div class="user-list-page">
    <div class="page-header">
      <h1>用户管理</h1>
      <a-button type="primary" @click="showAddModal">
        <template #icon><PlusOutlined /></template>
        新增用户
      </a-button>
    </div>

    <div class="search-bar">
      <a-input-search
        v-model:value="searchText"
        placeholder="搜索用户名/邮箱/手机"
        style="width: 300px"
        @search="handleSearch"
      />
    </div>

    <a-table
      :columns="columns"
      :data-source="userList"
      :loading="loading"
      :pagination="pagination"
      @change="handleTableChange"
      row-key="id"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'avatar'">
          <a-avatar :src="record.avatar" :alt="record.nickname" />
        </template>
        <template v-if="column.key === 'role'">
          <a-tag :color="record.role === 'admin' ? 'red' : 'blue'">
            {{ record.role === 'admin' ? '管理员' : '普通用户' }}
          </a-tag>
        </template>
        <template v-if="column.key === 'enabled'">
          <a-switch
            v-model:checked="record.enabled"
            checked-children="启用"
            un-checked-children="禁用"
            @change="handleToggleStatus(record)"
          />
        </template>
        <template v-if="column.key === 'action'">
          <a-space>
            <a @click="viewUser(record)">详情</a>
            <a @click="editUser(record)">编辑</a>
            <a-popconfirm
              title="确定要删除该用户吗？"
              ok-text="确定"
              cancel-text="取消"
              @confirm="handleDelete(record)"
            >
              <a class="text-danger">删除</a>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 新增/编辑用户模态框 -->
    <a-modal
      v-model:open="modalVisible"
      :title="modalTitle"
      @ok="handleModalOk"
      @cancel="modalVisible = false"
    >
      <a-form :model="formData" :label-col="{ span: 6 }" :wrapper-col="{ span: 16 }">
        <a-form-item label="用户名" name="username" :rules="[{ required: true, message: '请输入用户名' }]">
          <a-input v-model:value="formData.username" placeholder="请输入用户名" />
        </a-form-item>
        <a-form-item label="邮箱" name="email">
          <a-input v-model:value="formData.email" placeholder="请输入邮箱" />
        </a-form-item>
        <a-form-item label="手机号" name="phone">
          <a-input v-model:value="formData.phone" placeholder="请输入手机号" />
        </a-form-item>
        <a-form-item label="昵称" name="nickname">
          <a-input v-model:value="formData.nickname" placeholder="请输入昵称" />
        </a-form-item>
        <a-form-item label="角色" name="role">
          <a-select v-model:value="formData.role">
            <a-select-option value="user">普通用户</a-select-option>
            <a-select-option value="admin">管理员</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="状态" name="enabled">
          <a-switch v-model:checked="formData.enabled" checked-children="启用" un-checked-children="禁用" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { PlusOutlined } from '@ant-design/icons-vue';
import type { TablePaginationConfig } from 'ant-design-vue';
import { message } from 'ant-design-vue';
import { getUserList, createUser, updateUser, deleteUser, toggleUserStatus as toggleUserStatusApi } from '@/api/user';
import type { UserInfo } from '@web-system/types';

interface User {
  id: number | string;
  username: string;
  email?: string;
  phone?: string;
  nickname?: string;
  avatar?: string;
  role: string;
  enabled: boolean;
  createdAt: string;
}

const loading = ref(false);
const userList = ref<User[]>([]);
const searchText = ref('');
const modalVisible = ref(false);
const modalTitle = ref('新增用户');
const editingId = ref<string | number | null>(null);

const formData = reactive<any>({
  username: '',
  email: '',
  phone: '',
  nickname: '',
  role: 'user',
  enabled: true,
});

const columns = [
  { title: '头像', dataIndex: 'avatar', key: 'avatar', width: 80 },
  { title: '用户名', dataIndex: 'username', key: 'username' },
  { title: '邮箱', dataIndex: 'email', key: 'email' },
  { title: '手机号', dataIndex: 'phone', key: 'phone' },
  { title: '昵称', dataIndex: 'nickname', key: 'nickname' },
  { title: '角色', dataIndex: 'role', key: 'role', width: 100 },
  { title: '状态', dataIndex: 'enabled', key: 'enabled', width: 100 },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
  { title: '操作', key: 'action', width: 200, fixed: 'right' },
];

const pagination = reactive<TablePaginationConfig>({
  current: 1,
  pageSize: 10,
  total: 0,
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`,
});

onMounted(() => {
  fetchUsers();
});

const DEFAULT_AVATAR = '/avatars/default-avatar.png';

async function fetchUsers() {
  loading.value = true;
  try {
    const res = await getUserList({ 
      page: pagination.current, 
      limit: pagination.pageSize,
      keyword: searchText.value || undefined
    });
    // 为没有头像的用户设置默认头像
    userList.value = (res.list || []).map((user: any) => ({
      ...user,
      avatar: user.avatar || DEFAULT_AVATAR,
      role: user.role || 'user',
      enabled: user.enabled !== undefined ? user.enabled : true,
      createdAt: user.createdAt || ''
    }));
    pagination.total = res.total || 0;
  } catch (error) {
    console.error('Fetch users error:', error);
    message.error('获取用户列表失败');
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
    username: '',
    email: '',
    phone: '',
    nickname: '',
    role: 'user',
    enabled: true,
  });
  modalVisible.value = true;
}

function viewUser(record: User) {
  // 跳转到用户详情页面
  window.location.hash = `/users/${record.id}`;
}

function editUser(record: User) {
  modalTitle.value = '编辑用户';
  editingId.value = record.id;
  Object.assign(formData, record);
  modalVisible.value = true;
}

async function handleModalOk() {
  try {
    const userData = { ...formData } as any;
    if (editingId.value) {
      await updateUser(String(editingId.value), userData);
      message.success('更新成功');
    } else {
      await createUser(userData);
      message.success('创建成功');
    }
    modalVisible.value = false;
    fetchUsers();
  } catch (error) {
    console.error('User operation error:', error);
    message.error('操作失败');
  }
}

async function handleDelete(record: User) {
  try {
    await deleteUser(String(record.id));
    message.success('删除成功');
    fetchUsers();
  } catch (error) {
    console.error('Delete user error:', error);
    message.error('删除失败');
  }
}

async function handleToggleStatus(record: User) {
  try {
    await toggleUserStatusApi(String(record.id), record.enabled);
    message.success(record.enabled ? '已启用' : '已禁用');
  } catch (error) {
    console.error('Toggle status error:', error);
    record.enabled = !record.enabled;
    message.error('操作失败');
  }
}
</script>

<style scoped>
.user-list-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
}

.search-bar {
  margin-bottom: 16px;
}

.text-danger {
  color: #ff4d4f;
}
</style>

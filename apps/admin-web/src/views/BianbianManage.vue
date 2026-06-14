<template>
  <div class="bianbian-manage">
    <!-- 页头 -->
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-header-icon">
          <ThunderboltOutlined />
        </div>
        <div>
          <h2 class="page-title">变变素材库</h2>
          <p class="page-subtitle">管理「变变」产品中的可拼贴素材，包括 emoji、形状、颜色背景等</p>
        </div>
      </div>
      <div class="page-header-actions">
        <a-tooltip title="初始化系统默认素材库">
          <a-button :loading="seeding" @click="handleSeed">
            <template #icon><ReloadOutlined /></template>
            初始化素材
          </a-button>
        </a-tooltip>
        <a-button type="primary" @click="openAddModal">
          <template #icon><PlusOutlined /></template>
          新增素材
        </a-button>
      </div>
    </div>

    <!-- 分类 Tabs -->
    <div class="category-tabs">
      <div
        v-for="cat in categories"
        :key="cat.id"
        class="category-tab"
        :class="{ active: activeCategory === cat.id }"
        @click="switchCategory(cat.id)"
      >
        <span class="cat-icon">{{ cat.icon }}</span>
        <span class="cat-name">{{ cat.name }}</span>
        <span class="cat-count">{{ cat.count }}</span>
      </div>
    </div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <a-input-search
        v-model:value="searchKeyword"
        placeholder="搜索素材名称..."
        allow-clear
        @search="doSearch"
        @pressEnter="doSearch"
        class="search-input"
      />
      <div class="search-info" v-if="searchKeyword || activeCategory !== 'all'">
        <span>找到 <strong>{{ materials.length }}</strong> 个素材</span>
        <a-button type="link" size="small" @click="resetFilters">清除筛选</a-button>
      </div>
    </div>

    <!-- 素材网格 -->
    <div class="material-grid" v-if="materials.length > 0">
      <div
        v-for="item in materials"
        :key="item.id"
        class="material-card"
        :class="{ 'is-disabled': !item.enabled }"
      >
        <!-- 素材预览 -->
        <div class="card-preview" :class="item.type">
          <template v-if="item.type === 'color'">
            <div class="color-swatch" :style="{ backgroundColor: item.content }"></div>
          </template>
          <template v-else>
            <span class="emoji-display">{{ item.content }}</span>
          </template>
        </div>

        <!-- 素材信息 -->
        <div class="card-body">
          <div class="card-name">{{ item.name }}</div>
          <div class="card-meta">
            <span class="card-source" :class="item.source">
              {{ item.source === 'system' ? '系统' : '自定义' }}
            </span>
            <a-tag v-if="!item.enabled" color="default" class="disabled-tag">已禁用</a-tag>
          </div>
          <div class="card-tags" v-if="item.tags">
            <span v-for="tag in item.tags.split(',').filter(Boolean)" :key="tag" class="card-tag">{{ tag }}</span>
          </div>
        </div>

        <!-- 操作层 -->
        <div class="card-overlay">
          <div class="overlay-actions">
            <a-tooltip title="编辑">
              <a-button type="text" size="small" class="action-btn" @click.stop="openEditModal(item)">
                <template #icon><EditOutlined /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip :title="item.enabled ? '禁用' : '启用'">
              <a-button
                type="text"
                size="small"
                class="action-btn"
                @click.stop="toggleEnabled(item)"
              >
                <template #icon>
                  <EyeOutlined v-if="item.enabled" />
                  <EyeInvisibleOutlined v-else />
                </template>
              </a-button>
            </a-tooltip>
            <a-popconfirm
              title="确定要删除这个素材？"
              description="删除后不可恢复"
              @confirm="handleDelete(item)"
            >
              <a-tooltip title="删除">
                <a-button type="text" size="small" class="action-btn danger" @click.stop>
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </a-tooltip>
            </a-popconfirm>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态 -->
    <a-empty v-else class="empty-state" description="暂无素材">
      <template #image>
        <ThunderboltOutlined style="font-size: 48px; color: rgba(255,140,66,.3);" />
      </template>
      <template #description>
        <span style="color: #64748B;">还没有素材哦～</span>
      </template>
      <a-button type="primary" @click="handleSeed" :loading="seeding" v-if="!loading">
        初始化默认素材
      </a-button>
    </a-empty>

    <!-- 加载态 -->
    <div class="loading-state" v-if="loading">
      <a-spin size="large" />
      <p>加载素材库...</p>
    </div>

    <!-- 编辑弹窗 -->
    <a-modal
      v-model:open="modalOpen"
      :title="editingId ? '编辑素材' : '新增素材'"
      width="520px"
      :confirm-loading="saving"
      @ok="handleSave"
      class="material-modal"
      destroy-on-close
    >
      <a-form layout="vertical">
        <a-row :gutter="16">
          <a-col :span="16">
            <a-form-item label="素材名称" required>
              <a-input v-model:value="form.name" placeholder="如：星星" />
            </a-form-item>
          </a-col>
          <a-col :span="8">
            <a-form-item label="排序">
              <a-input-number v-model:value="form.sortOrder" :min="0" :max="999" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="内容" required>
          <a-input v-model:value="form.content" placeholder="Emoji 字符（如 ⭐）或颜色值（如 #FF8C42）" />
          <div class="preview-hint" v-if="form.content">
            预览：<span class="inline-preview">{{ form.content }}</span>
          </div>
        </a-form-item>
        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="分类" required>
              <a-select v-model:value="form.category">
                <a-select-option
                  v-for="cat in categories.filter(c => c.id !== 'all')"
                  :key="cat.id"
                  :value="cat.id"
                >
                  {{ cat.icon }} {{ cat.name }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="类型">
              <a-select v-model:value="form.type">
                <a-select-option value="emoji">Emoji</a-select-option>
                <a-select-option value="color">颜色</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item label="标签（逗号分隔）">
          <a-input v-model:value="form.tags" placeholder="如：星星,闪闪发光,贴纸" />
        </a-form-item>
        <a-form-item label="素材描述">
          <a-textarea v-model:value="form.description" :rows="2" placeholder="对这个素材的简短说明..." />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { message } from 'ant-design-vue';
import {
  ThunderboltOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ReloadOutlined,
} from '@ant-design/icons-vue';
import {
  getMaterialCategories,
  getMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  seedMaterials,
} from '@/api/bianbian';
import type { MaterialCategory, MaterialItem } from '@/api/bianbian';

// ========== 状态 ==========
const loading = ref(true);
const seeding = ref(false);
const saving = ref(false);
const categories = ref<MaterialCategory[]>([]);
const materials = ref<MaterialItem[]>([]);
const activeCategory = ref('all');
const searchKeyword = ref('');
const modalOpen = ref(false);
const editingId = ref<string | null>(null);

const form = reactive({
  name: '',
  content: '',
  category: 'sticker',
  type: 'emoji',
  tags: '',
  description: '',
  sortOrder: 99,
});

// ========== 数据加载 ==========

async function loadCategories() {
  try {
    const res: any = await getMaterialCategories();
    categories.value = [
      { id: 'all', name: '全部', icon: '🎨', count: 0 },
      ...(res.data || []),
    ];
  } catch {
    categories.value = [{ id: 'all', name: '全部', icon: '🎨', count: 0 }];
  }
}

async function loadMaterials() {
  loading.value = true;
  try {
    const res: any = await getMaterials({
      category: activeCategory.value === 'all' ? undefined : activeCategory.value,
      keyword: searchKeyword.value || undefined,
    });
    materials.value = res.data?.list || [];
    // 更新总数
    if (categories.value.length > 0) {
      categories.value[0].count = categories.value.slice(1).reduce((s, c) => s + c.count, 0);
    }
  } catch {
    materials.value = [];
  }
  loading.value = false;
}

// ========== 交互 ==========

function switchCategory(id: string) {
  activeCategory.value = id;
  loadMaterials();
}

function doSearch() {
  loadMaterials();
}

function resetFilters() {
  searchKeyword.value = '';
  activeCategory.value = 'all';
  loadMaterials();
}

function resetForm() {
  form.name = '';
  form.content = '';
  form.category = 'sticker';
  form.type = 'emoji';
  form.tags = '';
  form.description = '';
  form.sortOrder = 99;
}

function openAddModal() {
  editingId.value = null;
  resetForm();
  modalOpen.value = true;
}

function openEditModal(item: MaterialItem) {
  editingId.value = item.id;
  form.name = item.name;
  form.content = item.content;
  form.category = item.category;
  form.type = item.type;
  form.tags = item.tags || '';
  form.description = item.description || '';
  form.sortOrder = item.sortOrder;
  modalOpen.value = true;
}

async function handleSave() {
  if (!form.name || !form.content) {
    message.warning('名称和内容不能为空');
    return;
  }
  saving.value = true;
  try {
    const payload = { ...form };
    if (editingId.value) {
      await updateMaterial(editingId.value, payload);
      message.success('素材更新成功');
    } else {
      await createMaterial(payload);
      message.success('素材创建成功');
    }
    modalOpen.value = false;
    loadMaterials();
    loadCategories();
  } catch {
    message.error('操作失败');
  }
  saving.value = false;
}

async function toggleEnabled(item: MaterialItem) {
  try {
    await updateMaterial(item.id, { enabled: !item.enabled });
    item.enabled = !item.enabled;
    message.success(item.enabled ? '已启用' : '已禁用');
    loadCategories(); // 刷新计数
  } catch {
    message.error('操作失败');
  }
}

async function handleDelete(item: MaterialItem) {
  try {
    await deleteMaterial(item.id);
    message.success('素材已删除');
    loadMaterials();
    loadCategories();
  } catch {
    message.error('删除失败');
  }
}

async function handleSeed() {
  seeding.value = true;
  try {
    const res: any = await seedMaterials();
    message.success(res.message || '素材库初始化完成');
    loadMaterials();
    loadCategories();
  } catch {
    message.error('初始化失败');
  }
  seeding.value = false;
}

// ========== 初始化 ==========

onMounted(async () => {
  await loadCategories();
  await loadMaterials();
});
</script>

<style scoped>
.bianbian-manage {
  padding: 8px 0;
}

/* ========== 页头 ========== */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.page-header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.page-header-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(255,140,66,.15), rgba(255,140,66,.05));
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  color: #FF8C42;
}
.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #F1F5F9;
  line-height: 1.3;
}
.page-subtitle {
  margin: 2px 0 0;
  font-size: 13px;
  color: #64748B;
}
.page-header-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

/* ========== 分类 Tabs ========== */
.category-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.category-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 10px;
  cursor: pointer;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.06);
  transition: all .2s;
  user-select: none;
}
.category-tab:hover {
  background: rgba(255,140,66,.08);
  border-color: rgba(255,140,66,.2);
}
.category-tab.active {
  background: linear-gradient(135deg, rgba(255,140,66,.15), rgba(255,140,66,.05));
  border-color: rgba(255,140,66,.35);
}
.category-tab .cat-icon {
  font-size: 16px;
  line-height: 1;
}
.category-tab .cat-name {
  font-size: 13px;
  color: #CBD5E1;
  font-weight: 500;
}
.category-tab.active .cat-name {
  color: #FF8C42;
}
.category-tab .cat-count {
  font-size: 11px;
  color: #64748B;
  background: rgba(255,255,255,.06);
  padding: 1px 7px;
  border-radius: 8px;
  font-weight: 500;
}
.category-tab.active .cat-count {
  background: rgba(255,140,66,.15);
  color: #FF8C42;
}

/* ========== 搜索栏 ========== */
.search-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.search-input {
  max-width: 320px;
}
.search-input :deep(.ant-input) {
  background: rgba(255,255,255,.04) !important;
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 8px;
  color: #E2E8F0;
}
.search-input :deep(.ant-input:focus) {
  border-color: #FF8C42;
  box-shadow: 0 0 0 2px rgba(255,140,66,.1);
}
.search-input :deep(.ant-btn) {
  border-color: rgba(255,255,255,.08);
  color: #94A3B8;
}
.search-input :deep(.ant-btn:hover) {
  color: #FF8C42;
  border-color: #FF8C42;
}
.search-info {
  font-size: 13px;
  color: #64748B;
  display: flex;
  align-items: center;
  gap: 4px;
}
.search-info strong {
  color: #CBD5E1;
}

/* ========== 素材网格 ========== */
.material-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
.material-card {
  background: linear-gradient(135deg, #141419 0%, #16161C 100%);
  border: 1px solid rgba(255,255,255,.06);
  border-radius: 12px;
  overflow: hidden;
  transition: all .25s;
  position: relative;
  cursor: pointer;
}
.material-card:hover {
  transform: translateY(-2px);
  border-color: rgba(255,140,66,.25);
  box-shadow: 0 8px 24px rgba(0,0,0,.3);
}
.material-card.is-disabled {
  opacity: .5;
}

/* 预览区 */
.card-preview {
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,.02);
  border-bottom: 1px solid rgba(255,255,255,.04);
  transition: background .2s;
}
.material-card:hover .card-preview {
  background: rgba(255,140,66,.04);
}
.card-preview .emoji-display {
  font-size: 48px;
  line-height: 1;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,.2));
}
.card-preview.color {
  padding: 16px;
}
.color-swatch {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  border: 2px solid rgba(255,255,255,.1);
  box-shadow: 0 2px 8px rgba(0,0,0,.2);
}

/* 信息区 */
.card-body {
  padding: 12px;
}
.card-name {
  font-size: 14px;
  font-weight: 600;
  color: #E2E8F0;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}
.card-source {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 4px;
  font-weight: 500;
}
.card-source.system {
  background: rgba(59,130,246,.1);
  color: #60A5FA;
}
.card-source.custom {
  background: rgba(255,140,66,.1);
  color: #FF8C42;
}
.disabled-tag {
  font-size: 11px;
  line-height: 1.4;
  color: #64748B;
}
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.card-tag {
  font-size: 11px;
  color: #64748B;
  background: rgba(255,255,255,.04);
  padding: 1px 6px;
  border-radius: 4px;
}

/* 悬停操作层 */
.card-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8px;
  opacity: 0;
  transition: opacity .2s;
  background: rgba(0,0,0,.4);
  border-radius: 12px;
}
.material-card:hover .card-overlay {
  opacity: 1;
}
.overlay-actions {
  display: flex;
  gap: 4px;
  background: rgba(20,20,25,.9);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 8px;
  padding: 4px;
}
.action-btn {
  width: 32px;
  height: 32px;
  color: #94A3B8;
  border-radius: 6px;
  transition: all .15s;
}
.action-btn:hover {
  color: #E2E8F0;
  background: rgba(255,140,66,.15);
}
.action-btn.danger:hover {
  color: #EF4444;
  background: rgba(239,68,68,.12);
}

/* ========== 空状态 & 加载 ========== */
.empty-state {
  margin: 80px 0;
}
.loading-state {
  text-align: center;
  padding: 80px 0;
  color: #64748B;
}
.loading-state p {
  margin-top: 12px;
  font-size: 14px;
}

/* ========== 弹窗 ========== */
.material-modal :deep(.ant-modal-content) {
  background: #141419;
  border: 1px solid rgba(255,255,255,.08);
}
.material-modal :deep(.ant-modal-header) {
  background: transparent;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.material-modal :deep(.ant-modal-title) {
  color: #F1F5F9;
}
.material-modal :deep(.ant-modal-footer) {
  border-top: 1px solid rgba(255,255,255,.06);
}
.material-modal :deep(.ant-form-item-label label) {
  color: #94A3B8;
}
.material-modal :deep(.ant-input) {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.08);
  color: #E2E8F0;
  border-radius: 8px;
}
.material-modal :deep(.ant-input:focus) {
  border-color: #FF8C42;
  box-shadow: 0 0 0 2px rgba(255,140,66,.1);
}
.material-modal :deep(.ant-select-selector) {
  background: rgba(255,255,255,.04) !important;
  border: 1px solid rgba(255,255,255,.08) !important;
  border-radius: 8px !important;
}
.material-modal :deep(.ant-select-focused .ant-select-selector) {
  border-color: #FF8C42 !important;
  box-shadow: 0 0 0 2px rgba(255,140,66,.1) !important;
}
.material-modal :deep(.ant-select-selection-item) {
  color: #E2E8F0;
}
.material-modal :deep(.ant-input-number) {
  width: 100%;
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 8px;
}
.preview-hint {
  margin-top: 6px;
  font-size: 13px;
  color: #64748B;
}
.inline-preview {
  font-size: 20px;
  margin-left: 4px;
}
</style>

<template>
  <div class="db-page">
    <!-- 页头 -->
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">数据浏览</h1>
        <p class="page-subtitle">查看 web_system 业务库的表结构与数据，只读 · 凭证字段已隐藏，个人信息已打码</p>
      </div>
      <a-button :loading="refreshing" @click="refreshAll">
        <template #icon><ReloadOutlined /></template>
        刷新
      </a-button>
    </div>

    <a-tabs v-model:activeKey="mode" class="db-mode-tabs">
      <!-- Tab 1 · 数据浏览 -->
      <a-tab-pane key="browse" tab="数据浏览">
        <div class="browse-layout">
          <!-- 左栏：表列表 -->
          <aside class="panel ws-hairline table-panel">
            <div class="panel-title">数据表<span class="panel-count">{{ tables.length }}</span></div>
            <div class="panel-body">
              <div class="table-list-wrap">
                <a-input-search
                  v-model:value="keyword"
                  placeholder="搜索表名或注释"
                  allow-clear
                  size="small"
                />
                <div class="table-list" v-if="!tableLoading">
                  <div
                    v-for="t in filteredTables"
                    :key="t.name"
                    class="table-item"
                    :class="{ selected: t.name === selectedTable }"
                    @click="selectTable(t.name)"
                  >
                    <span class="table-name">
                      <span class="ws-mono">{{ t.name }}</span>
                      <a-tag v-if="t.sensitive" class="tag-sensitive">敏感</a-tag>
                    </span>
                    <span class="table-rows">{{ fmtRows(t.rows) }}</span>
                  </div>
                  <a-empty v-if="!filteredTables.length" description="未匹配到表，调整关键词" class="list-empty" />
                </div>
                <div v-else class="list-loading"><a-spin size="small" /></div>
                <a-button v-if="tableError" type="link" size="small" class="retry-btn" @click="loadTables">
                  加载失败，点击重试
                </a-button>
              </div>
            </div>
          </aside>

          <!-- 右栏：Tab 切换（数据 / 表结构） -->
          <div v-if="schema" class="panel ws-hairline detail-panel">
            <div class="detail-head">
              <span class="detail-name">
                <span class="ws-mono">{{ schema.tableName }}</span>
                <span v-if="schema.comment" class="detail-comment">{{ schema.comment }}</span>
              </span>
              <a-tabs v-model:activeKey="viewMode" size="small" class="detail-tabs">
                <a-tab-pane key="data" :tab="`数据 (${fmtRows(rowsTotal)})`" />
                <a-tab-pane key="schema" :tab="`表结构 (${schema.columns.length})`" />
              </a-tabs>
            </div>

            <!-- 数据 pane -->
            <div v-show="viewMode === 'data'" class="view-body">
              <a-table
                :columns="dataColumns"
                :data-source="dataRows"
                :loading="rowsLoading"
                :pagination="pagination"
                size="small"
                row-key="_ws_key"
                :scroll="{ x: 'max-content' }"
                @change="onDataTableChange"
              >
                <template #bodyCell="{ column, record }">
                  <span
                    :class="cellCls(column, record[column.dataIndex])"
                    @click="cellLong(record[column.dataIndex]) && openCell(column, record)"
                  >
                    {{ cellText(record[column.dataIndex]) }}
                  </span>
                </template>
              </a-table>
            </div>

            <!-- 表结构 pane -->
            <div v-show="viewMode === 'schema'" class="view-body">
              <a-table
                :columns="schemaColumns"
                :data-source="schema.columns"
                size="small"
                row-key="name"
                :pagination="false"
                :scroll="{ x: 'max-content' }"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'name'">
                    <span class="ws-mono">{{ record.name }}</span>
                    <a-tag v-if="record.sensitive === 'hidden'" class="tag-hidden">隐藏</a-tag>
                    <a-tag v-else-if="record.sensitive === 'masked'" class="tag-masked">打码</a-tag>
                  </template>
                  <template v-else-if="column.key === 'type'">
                    <span class="ws-mono">{{ record.type }}</span>
                  </template>
                  <template v-else-if="column.key === 'nullable'">
                    <span>{{ record.nullable ? '是' : '否' }}</span>
                  </template>
                  <template v-else-if="column.key === 'defaultValue'">
                    <span v-if="record.defaultValue === null" class="cell-null">NULL</span>
                    <span v-else class="ws-mono">{{ record.defaultValue }}</span>
                  </template>
                  <template v-else-if="column.key === 'key'">
                    <a-tag v-if="record.key === 'PRI'" class="tag-pri">主键</a-tag>
                    <a-tag v-else-if="record.key === 'UNI'" class="tag-uni">唯一</a-tag>
                    <a-tag v-else-if="record.key === 'MUL'" class="tag-mul">索引</a-tag>
                    <span v-else class="cell-null">—</span>
                  </template>
                  <template v-else-if="column.key === 'comment'">
                    <span class="cell-comment">{{ record.comment || '—' }}</span>
                  </template>
                </template>
              </a-table>

              <div v-if="schema.indexes.length" class="index-block">
                <div class="index-title">索引（{{ schema.indexes.length }}）</div>
                <div v-for="idx in schema.indexes" :key="idx.name" class="index-item">
                  <a-tag :class="idx.unique ? 'tag-uni' : 'tag-mul'">
                    {{ idx.unique ? 'UNIQUE' : 'INDEX' }}
                  </a-tag>
                  <span class="ws-mono index-name">{{ idx.name }}</span>
                  <span class="ws-mono index-cols">({{ idx.columns.join(', ') }})</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 占位 / 加载失败 -->
          <div v-else class="panel ws-hairline detail-placeholder">
            <template v-if="schemaError">
              <div class="placeholder-box">
                <p class="placeholder-text">加载失败：{{ schemaError }}</p>
                <a-button size="small" @click="reloadSelection">重试</a-button>
              </div>
            </template>
            <p v-else class="placeholder-text">在左侧选择一张表开始浏览</p>
          </div>
        </div>
      </a-tab-pane>

      <!-- Tab 2 · SQL 控制台（仅 super_admin） -->
      <a-tab-pane v-if="canQuery" key="sql" tab="SQL 控制台">
        <div class="sql-pane">
          <a-alert type="info" show-icon :closable="false">
            <template #message>
              <span class="sql-hint">
                仅允许单条 <code class="ws-mono">SELECT</code> 查询，自动附加 <code class="ws-mono">LIMIT 200</code>；
                禁止 INSERT / UPDATE / DELETE / DROP 等写操作；数据库账号只读；每次执行均写入审计日志。
              </span>
            </template>
          </a-alert>
          <a-textarea
            v-model:value="sqlText"
            :rows="6"
            class="sql-editor ws-mono"
            placeholder="SELECT id, username, phone, created_at FROM users WHERE enabled = 1"
            @keydown.ctrl.enter="runSql"
            @keydown.meta.enter="runSql"
          />
          <div class="sql-bar">
            <a-button type="primary" :loading="sqlRunning" @click="runSql">执行</a-button>
            <span class="sql-tip">Ctrl / ⌘ + Enter 执行</span>
          </div>

          <template v-if="sqlResult">
            <div class="sql-meta">
              <span>返回 {{ sqlResult.rowCount }} 行 · {{ sqlResult.elapsedMs }} ms</span>
              <a-tag v-if="sqlResult.truncated" class="tag-warn">结果已截断至 200 行</a-tag>
            </div>
            <a-table
              :columns="sqlColumns"
              :data-source="sqlRows"
              size="small"
              :pagination="false"
              :scroll="{ x: 'max-content' }"
            >
              <template #bodyCell="{ column, record }">
                <span :class="cellCls(column, record[column.dataIndex])">
                  {{ cellText(record[column.dataIndex]) }}
                </span>
              </template>
            </a-table>
          </template>
        </div>
      </a-tab-pane>
    </a-tabs>

    <!-- 单元格全文 Drawer -->
    <a-drawer v-model:open="cellOpen" :title="cellTitle" width="640">
      <div class="cell-full ws-mono">{{ cellValue }}</div>
      <a-button type="primary" class="cell-copy" @click="copyCell">
        <template #icon><CopyOutlined /></template>
        复制全文
      </a-button>
    </a-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, h, type VNode } from 'vue';
import { message, Tag } from 'ant-design-vue';
import type { TableColumnsType, TablePaginationConfig } from 'ant-design-vue';

/** antd table 的排序载荷（antd-vue 4.2 未导出 SorterResult，自行声明最小结构） */
interface SortPayload {
  order?: 'ascend' | 'descend' | null;
  field?: string | number | symbol;
}
import { ReloadOutlined, CopyOutlined } from '@ant-design/icons-vue';
import { useUserStore } from '@/stores/user';
import {
  listDbTables,
  getDbSchema,
  getDbRows,
  runDbSql,
  type DbTableInfo,
  type TableSchema,
  type SensitiveLevel,
  type SqlResult,
} from '@/api/database';

const userStore = useUserStore();

const PAGE_SIZE = 50;
const TRUNCATE_LEN = 60;
type RowType = Record<string, unknown>;

// 主操作模式：browse | sql
const mode = ref('browse');
const viewMode = ref('data');
const refreshing = ref(false);

// 表列表
const tables = ref<DbTableInfo[]>([]);
const tableLoading = ref(false);
const tableError = ref('');
const keyword = ref('');

// 选中表
const selectedTable = ref('');
const schema = ref<TableSchema | null>(null);
const schemaError = ref('');

// 数据表格
const dataRows = ref<RowType[]>([]);
const rowsLoading = ref(false);
const rowsTotal = ref(0);
const page = ref(1);
const sortField = ref('');
const sortOrder = ref<'asc' | 'desc' | null>(null);

// SQL
const canQuery = computed(() => userStore.hasPermission('database:query'));
const sqlText = ref('SELECT id, username, phone, created_at\nFROM users\nWHERE enabled = 1');
const sqlRunning = ref(false);
const sqlResult = ref<SqlResult | null>(null);

// Drawer
const cellOpen = ref(false);
const cellTitle = ref('');
const cellValue = ref('');

const filteredTables = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return tables.value;
  return tables.value.filter(
    (t) => t.name.toLowerCase().includes(kw) || (t.comment || '').toLowerCase().includes(kw),
  );
});

// ── 加载表列表 ──────────────────────────────────────
async function loadTables() {
  tableLoading.value = true;
  tableError.value = '';
  try {
    tables.value = await listDbTables();
  } catch {
    tableError.value = '表列表加载失败';
  } finally {
    tableLoading.value = false;
  }
}

// ── 选择表 ──────────────────────────────────────────
async function selectTable(name: string) {
  if (name === selectedTable.value) return;
  selectedTable.value = name;
  viewMode.value = 'data';
  page.value = 1;
  sortField.value = '';
  sortOrder.value = null;
  await reloadSelection();
}

async function reloadSelection() {
  if (!selectedTable.value) return;
  schema.value = null;
  schemaError.value = '';
  rowsTotal.value = 0;
  try {
    schema.value = await getDbSchema(selectedTable.value);
    await fetchRows();
  } catch (err) {
    schemaError.value = (err as Error).message || '加载失败';
  }
}

async function fetchRows() {
  if (!selectedTable.value) return;
  rowsLoading.value = true;
  try {
    const res = await getDbRows(selectedTable.value, {
      page: page.value,
      pageSize: PAGE_SIZE,
      sortField: sortField.value || undefined,
      sortOrder: sortOrder.value || undefined,
    });
    dataRows.value = res.rows.map((r, i) => ({ ...r, _ws_key: `${page.value}-${i}` }));
    rowsTotal.value = res.total;
  } catch {
    // 错误提示由 request 拦截器统一弹 message
  } finally {
    rowsLoading.value = false;
  }
}

function refreshAll() {
  refreshing.value = true;
  Promise.all([loadTables(), reloadSelection()]).finally(() => {
    refreshing.value = false;
  });
}

// ── 分页 / 排序 ────────────────────────────────────
const pagination = computed(() => ({
  current: page.value,
  pageSize: PAGE_SIZE,
  total: rowsTotal.value,
  showSizeChanger: false,
  showTotal: (total: number) => `共 ${total.toLocaleString()} 行`,
}));

function onDataTableChange(
  pg: TablePaginationConfig,
  _filters: Record<string, unknown>,
  sorter: SortPayload | SortPayload[],
) {
  const sort = Array.isArray(sorter) ? sorter[0] : sorter;
  if (pg?.current && pg.current !== page.value) {
    page.value = pg.current;
    fetchRows();
    return;
  }
  if (sort?.field && sort.order) {
    sortField.value = String(sort.field);
    sortOrder.value = sort.order === 'ascend' ? 'asc' : 'desc';
  } else {
    sortField.value = '';
    sortOrder.value = null;
  }
  page.value = 1;
  fetchRows();
}

// ── 列定义 ──────────────────────────────────────────
function colTitle(name: string, sensitive: SensitiveLevel): string | VNode {
  if (!sensitive || sensitive === 'none') return name;
  const label = sensitive === 'hidden' ? '隐藏' : '脱敏';
  const cls = sensitive === 'hidden' ? 'tag tag-hidden' : 'tag tag-masked';
  return h('span', { class: 'col-title' }, [
    name,
    h(Tag, { class: cls }, { default: () => label }),
  ]);
}

const dataColumns = computed<TableColumnsType<RowType>>(() => {
  if (!schema.value) return [];
  return schema.value.columns.map((c) => ({
    title: colTitle(c.name, c.sensitive),
    dataIndex: c.name,
    key: c.name,
    width: Math.min(260, Math.max(120, c.name.length * 14 + 110)),
    sorter: true,
    sortOrder:
      sortField.value === c.name && sortOrder.value
        ? sortOrder.value === 'asc'
          ? 'ascend'
          : 'descend'
        : null,
  }));
});

const schemaColumns: TableColumnsType<Record<string, unknown>> = [
  { title: '字段', dataIndex: 'name', key: 'name', width: 220 },
  { title: '类型', dataIndex: 'type', key: 'type', width: 180 },
  { title: '可空', dataIndex: 'nullable', key: 'nullable', width: 64 },
  { title: '默认值', dataIndex: 'defaultValue', key: 'defaultValue', width: 150 },
  { title: '键', dataIndex: 'key', key: 'key', width: 76 },
  { title: '注释', dataIndex: 'comment', key: 'comment' },
];

const sqlColumns = computed<TableColumnsType<RowType>>(() =>
  (sqlResult.value?.columns ?? []).map((c) => ({
    title: colTitle(c.name, c.sensitive),
    dataIndex: c.name,
    key: c.name,
  })),
);

const sqlRows = computed(() => sqlResult.value?.rows ?? []);

// ── 执行 SQL ────────────────────────────────────────
async function runSql() {
  const text = sqlText.value.trim();
  if (!text) {
    message.warning('请输入 SQL');
    return;
  }
  if (sqlRunning.value) return;
  sqlRunning.value = true;
  try {
    sqlResult.value = await runDbSql(text);
    message.success(`执行成功：返回 ${sqlResult.value.rowCount} 行`);
  } finally {
    sqlRunning.value = false;
  }
}

// ── 单元格渲染 ──────────────────────────────────────
function isMonoColumn(name: string): boolean {
  return /(_id$|^id$|_at$|_by$|_url$|_key$|^key$|openid|unionid|_type$)/i.test(name);
}

function isLongValue(v: unknown): boolean {
  return typeof v === 'string' && v.length > TRUNCATE_LEN;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  const s = String(value);
  return isLongValue(s) ? `${s.slice(0, TRUNCATE_LEN)}…` : s;
}

function cellCls(column: { key?: string }, value: unknown): string {
  const parts: string[] = [];
  if (value === null || value === undefined) parts.push('cell-null');
  if (typeof value === 'number') parts.push('cell-num');
  if (typeof value !== 'object' && isMonoColumn(String(column.key ?? ''))) parts.push('ws-mono');
  if (isLongValue(value)) parts.push('cell-clickable');
  return parts.join(' ');
}

function cellLong(value: unknown): boolean {
  return isLongValue(value) || (typeof value === 'object' && value !== null);
}

function openCell(column: { key?: string; dataIndex?: string }, record: RowType) {
  const dataIndex = String(column.dataIndex ?? column.key ?? '');
  const value = record[dataIndex];
  cellTitle.value = `${selectedTable.value}.${dataIndex}`;
  cellValue.value =
    value === null || value === undefined
      ? 'NULL'
      : typeof value === 'object'
        ? JSON.stringify(value, null, 2)
        : String(value);
  cellOpen.value = true;
}

async function copyCell() {
  try {
    await navigator.clipboard.writeText(cellValue.value);
    message.success('已复制');
  } catch {
    message.error('复制失败，请手动选择复制');
  }
}

function fmtRows(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
  return n.toLocaleString();
}

onMounted(loadTables);
</script>

<style scoped>
.db-page {
  display: flex;
  flex-direction: column;
  /* content(flex) 提供确定高度，本页占满后内部面板各自滚动，外层不再整体滚动 */
  flex: 1;
  min-height: 0;
  /* 1) 不能 overflow:hidden：硬裁剪会把 panel 画在盒子外侧的 box-shadow 外框裁掉
   * 2) content 左右 padding 为 0，panel 左右外框 shadow 若顶满内容区会超出滚动容器
   *    左右边界被静默裁剪（只剩顶/底可见）；加左右 1px padding 让外框完整显示 */
  padding: 0 1px;
}

/* 页头 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--ws-space-16);
}
.page-title {
  font-size: var(--ws-font-size-h2);
  font-weight: 600;
  color: var(--ws-text-primary);
  line-height: 1.3;
  margin: 0;
}
.page-subtitle {
  color: var(--ws-text-tertiary);
  font-size: var(--ws-font-size-caption);
  margin-top: var(--ws-space-4);
}
.db-mode-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* 把确定高度从 a-tabs 透传进 tabpane：
 * .ant-tabs 是 flex column，nav 占自身高度，content-holder 用 flex:1 占「剩余」高度；
 * 不能给 content-holder height:100%，否则它位于 nav 之后还要 100% 整高，
 * 会让面板底部溢出被裁，造成底部边框缺失（边框显示不完整） */
.db-mode-tabs :deep(.ant-tabs-content-holder) {
  flex: 1;
  min-height: 0;
}
.db-mode-tabs :deep(.ant-tabs-content) {
  height: 100%;
}
.db-mode-tabs :deep(.ant-tabs-tabpane) {
  height: 100%;
}

/* 浏览布局：左右分栏 */
.browse-layout {
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  gap: var(--ws-space-16);
  align-items: stretch;
  height: 100%;
  min-height: 0;
}
.panel {
  background: var(--ws-bg-surface);
}
.panel-title {
  padding: var(--ws-space-12) var(--ws-space-16);
  font-weight: 500;
  color: var(--ws-text-primary);
  border-bottom: 1px solid var(--ws-border-subtle);
  display: flex;
  align-items: center;
  gap: var(--ws-space-8);
}
.panel-count {
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
  font-weight: 400;
}
.panel-body {
  padding: var(--ws-space-12);
  /* 参与高度链：占满 table-panel 剩余高度，否则内部 table-list 的 flex:1 相对“内容高”失效，
     永远不触发 overflow 滚动，列表底部还会被外层 overflow:hidden 裁掉 */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 表列表：固定高度 + 内部 flex 滚动（panel-body 必须有 min-height:0 + overflow:hidden
   才能让 table-list 的 flex:1 真正算出可滚动高度） */
.table-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /* 不能 overflow:hidden：会裁掉 .ws-hairline 用 box-shadow 画的外框。
   * 高度由 grid stretch + 内部 panel-body overflow 控制，无需在此裁剪 */
}
.table-list-wrap {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.table-list {
  margin-top: var(--ws-space-8);
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.table-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--ws-space-8);
  border-radius: var(--ws-radius-sm);
  cursor: pointer;
  gap: var(--ws-space-8);
}
.table-item:hover {
  background: var(--ws-bg-hover);
}
.table-item.selected {
  background: var(--ws-brand-50);
}
.table-item.selected .ws-mono {
  color: var(--ws-brand-700);
}
.table-name {
  display: inline-flex;
  align-items: center;
  gap: var(--ws-space-4);
  min-width: 0;
  overflow: hidden;
}
.table-name .ws-mono {
  color: var(--ws-text-primary);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.table-rows {
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.table-item.selected .table-rows {
  color: var(--ws-brand-700);
}
.list-loading {
  display: flex;
  justify-content: center;
  padding: var(--ws-space-24) 0;
}
.list-empty {
  margin: var(--ws-space-16) 0;
}
.retry-btn {
  padding-left: 0;
  margin-top: var(--ws-space-8);
}

/* 右侧详情 */
.detail-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  /* 不能 overflow:hidden：会裁掉 .ws-hairline 用 box-shadow 画的外框。
   * 内部 view-body 自身 overflow:auto 处理滚动 */
}
.detail-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 var(--ws-space-16);
  border-bottom: 1px solid var(--ws-border-subtle);
  flex-wrap: wrap;
  gap: var(--ws-space-4);
}
.detail-name {
  display: inline-flex;
  align-items: baseline;
  gap: var(--ws-space-12);
  min-width: 0;
}
.detail-name .ws-mono {
  font-size: 15px;
  font-weight: 500;
  color: var(--ws-text-primary);
}
.detail-comment {
  color: var(--ws-text-tertiary);
  font-size: var(--ws-font-size-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.detail-tabs {
  margin: 0;
}
.detail-tabs :deep(.ant-tabs-nav) {
  margin: 0;
}
.detail-tabs :deep(.ant-tabs-nav .ant-tabs-tab) {
  padding: var(--ws-space-8) 0;
}
.view-body {
  flex: 1;
  min-height: 0;
  padding: var(--ws-space-8);
  overflow: auto;
}
.detail-placeholder {
  min-height: 420px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--ws-space-24);
}
.placeholder-text {
  color: var(--ws-text-tertiary);
}
.placeholder-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ws-space-12);
}

/* 单元格 */
.cell-null {
  color: var(--ws-text-tertiary);
  font-style: italic;
}
.cell-comment {
  color: var(--ws-text-secondary);
}
.cell-num {
  font-variant-numeric: tabular-nums;
}
.cell-clickable {
  cursor: pointer;
  border-bottom: 1px dashed var(--ws-border);
}
.cell-clickable:hover {
  color: var(--ws-brand-700);
}
.col-title {
  display: inline-flex;
  align-items: center;
  gap: var(--ws-space-4);
}

/* 索引 */
.index-block {
  margin-top: var(--ws-space-16);
  padding: var(--ws-space-12) var(--ws-space-16);
  border-top: 1px solid var(--ws-border-subtle);
}
.index-title {
  font-size: var(--ws-font-size-caption);
  font-weight: 500;
  color: var(--ws-text-secondary);
  margin-bottom: var(--ws-space-8);
}
.index-item {
  display: flex;
  align-items: center;
  gap: var(--ws-space-8);
  margin-bottom: var(--ws-space-4);
}
.index-name {
  color: var(--ws-text-secondary);
  font-size: 12px;
}
.index-cols {
  color: var(--ws-text-tertiary);
  font-size: 12px;
}

/* tag 语义色（状态/语义才配色） */
:deep(.tag-hidden) {
  color: var(--ws-error-500);
  background: var(--ws-error-100);
  border-color: transparent;
  font-size: 11px;
  line-height: 18px;
}
:deep(.tag-masked),
:deep(.tag-warn) {
  color: var(--ws-warning-500);
  background: var(--ws-warning-100);
  border-color: transparent;
  font-size: 11px;
  line-height: 18px;
}
:deep(.tag-sensitive),
:deep(.tag-pri),
:deep(.tag-uni),
:deep(.tag-mul) {
  color: var(--ws-brand-700);
  background: var(--ws-brand-50);
  border-color: transparent;
  font-size: 11px;
  line-height: 18px;
}

/* SQL 控制台 */
.sql-pane {
  display: flex;
  flex-direction: column;
  gap: var(--ws-space-12);
  height: 100%;
  min-height: 0;
  overflow: auto;
}
.sql-hint code {
  font-size: 12px;
}
.sql-editor {
  font-size: 13px;
  line-height: 1.6;
  background: var(--ws-bg-surface);
  border: 1px solid var(--ws-border);
  border-radius: var(--ws-radius-md);
  padding: var(--ws-space-12);
}
.sql-bar {
  display: flex;
  align-items: center;
  gap: var(--ws-space-12);
}
.sql-tip {
  font-size: var(--ws-font-size-caption);
  color: var(--ws-text-tertiary);
}
.sql-meta {
  display: flex;
  align-items: center;
  gap: var(--ws-space-8);
  color: var(--ws-text-secondary);
  font-size: var(--ws-font-size-caption);
}

/* Drawer */
.cell-full {
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--ws-bg-subtle);
  border: 1px solid var(--ws-border-subtle);
  border-radius: var(--ws-radius-md);
  padding: var(--ws-space-16);
  max-height: 60vh;
  overflow: auto;
}
.cell-copy {
  margin-top: var(--ws-space-16);
}
</style>

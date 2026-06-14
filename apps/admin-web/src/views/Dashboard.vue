<template>
  <div class="dashboard">
    <!-- 统计卡片 -->
    <a-row :gutter="16" class="stats-row">
      <a-col :xs="24" :sm="12" :lg="6">
        <div class="dash-card card-orange">
          <div class="dash-card-row">
            <a-statistic title="用户总数" :value="stats.totalUsers" :value-style="{ color: '#FF8C42' }">
              <template #prefix><UserOutlined /></template>
            </a-statistic>
            <div class="dash-card-icon"><UserOutlined /></div>
          </div>
          <div class="stat-trend">较上周 <span class="up">+12%</span></div>
        </div>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <div class="dash-card card-green">
          <div class="dash-card-row">
            <a-statistic title="今日活跃" :value="stats.activeToday" suffix="人" :value-style="{ color: '#22C55E' }">
              <template #prefix><RiseOutlined /></template>
            </a-statistic>
            <div class="dash-card-icon green"><RiseOutlined /></div>
          </div>
          <div class="stat-trend">较昨日 <span class="up">+5</span></div>
        </div>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <div class="dash-card card-blue">
          <div class="dash-card-row">
            <a-statistic title="课程总数" :value="stats.courses" suffix="门" :value-style="{ color: '#3B82F6' }">
              <template #prefix><BookOutlined /></template>
            </a-statistic>
            <div class="dash-card-icon blue"><BookOutlined /></div>
          </div>
          <div class="stat-trend">已发布 <span>{{ stats.coursesPublished }} 门</span></div>
        </div>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <div class="dash-card card-purple">
          <div class="dash-card-row">
            <a-statistic title="系统日志" :value="stats.logs" suffix="条" :value-style="{ color: '#A855F7' }">
              <template #prefix><FileTextOutlined /></template>
            </a-statistic>
            <div class="dash-card-icon purple"><FileTextOutlined /></div>
          </div>
          <div class="stat-trend">今日新增 <span>{{ stats.logsToday }}</span></div>
        </div>
      </a-col>
    </a-row>

    <!-- 图表区 -->
    <a-row :gutter="16" style="margin-top: 16px">
      <a-col :span="24">
        <div class="section-card">
          <div class="section-card-header">用户增长趋势</div>
          <v-chart :option="userChartOption" style="height: 360px" autoresize />
        </div>
      </a-col>
    </a-row>

    <a-row :gutter="16" style="margin-top: 16px">
      <a-col :span="14">
        <div class="section-card">
          <div class="section-card-header">最近操作日志</div>
          <a-table :columns="logColumns" :data-source="recentLogs" :pagination="false" size="small" class="dark-table" />
        </div>
      </a-col>
      <a-col :span="10">
        <div class="section-card">
          <div class="section-card-header">快捷操作</div>
          <a-space direction="vertical" style="width: 100%" :size="12">
            <a-button type="primary" size="large" block @click="router.push('/users')">
              <TeamOutlined /> 用户管理
            </a-button>
            <a-button size="large" block @click="router.push('/settings')">
              <SettingOutlined /> 系统设置
            </a-button>
            <a-button size="large" block @click="router.push('/settings?tab=logs')">
              <FileTextOutlined /> 查看操作日志
            </a-button>
          </a-space>
        </div>
      </a-col>
    </a-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { UserOutlined, RiseOutlined, BookOutlined, FileTextOutlined, TeamOutlined, SettingOutlined } from '@ant-design/icons-vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';

use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, LegendComponent]);

const router = useRouter();

const stats = ref({
  totalUsers: 0, activeToday: 0, courses: 12, coursesPublished: 8,
  logs: 0, logsToday: 0,
});

const logColumns = [
  { title: '时间', dataIndex: 'time', width: 140 },
  { title: '操作', dataIndex: 'action', ellipsis: true },
];
const recentLogs = ref<any[]>([]);

const userChartOption = ref({
  tooltip: { trigger: 'axis' },
  legend: { data: ['新增用户', '活跃用户'] },
  grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
  xAxis: { type: 'category', boundaryGap: false, data: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] },
  yAxis: { type: 'value' },
  series: [
    { name: '新增用户', type: 'line', smooth: true, data: [12, 18, 15, 25, 22, 30, 28], color: '#FF8C42', areaStyle: { color: 'rgba(255,140,66,0.1)' } },
    { name: '活跃用户', type: 'line', smooth: true, data: [30, 42, 38, 55, 48, 65, 60], color: '#1890ff', areaStyle: { color: 'rgba(24,144,255,0.1)' } },
  ],
});

onMounted(async () => {
  try {
    const [usersRes] = await Promise.all([
      fetch('/api/users?limit=1').then(r => r.json()).catch(() => ({ total: 128 })),
    ]);
    stats.value.totalUsers = usersRes.total || 128;
    stats.value.activeToday = 45;
    stats.value.logs = 328;
    stats.value.logsToday = 12;
    recentLogs.value = [
      { time: '2026-06-14 00:30', action: '管理员登录' },
      { time: '2026-06-13 23:45', action: '更新系统设置：站点名称' },
      { time: '2026-06-13 22:10', action: '创建新用户 teacher01' },
      { time: '2026-06-13 21:00', action: '修改安全策略配置' },
      { time: '2026-06-13 18:30', action: '查看用户列表' },
    ];
  } catch { /* use mock data */ }
});
</script>

<style scoped>
.dashboard { padding: 8px 0; }
.stats-row { margin-bottom: 0; }

/* 统计卡片 */
.dash-card {
  background: linear-gradient(135deg, #141419 0%, #16161C 100%);
  border: 1px solid rgba(255,255,255,.06); border-radius: 12px;
  padding: 20px 24px; transition: all .25s;
}
.dash-card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,.1); }
.dash-card-row { display: flex; justify-content: space-between; align-items: flex-start; }
.dash-card-icon {
  width: 40px; height: 40px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; flex-shrink: 0;
}
.dash-card-icon { color: #FF8C42; background: rgba(255,140,66,.1); }
.dash-card-icon.green { color: #22C55E; background: rgba(34,197,94,.1); }
.dash-card-icon.blue { color: #3B82F6; background: rgba(59,130,246,.1); }
.dash-card-icon.purple { color: #A855F7; background: rgba(168,85,247,.1); }

.stat-trend { margin-top: 10px; font-size: 13px; color: #64748B; }
.stat-trend .up { color: #22C55E; font-weight: 500; }

/* 区块卡片 */
.section-card {
  background: linear-gradient(135deg, #141419 0%, #16161C 100%);
  border: 1px solid rgba(255,255,255,.06); border-radius: 12px;
  padding: 24px;
}
.section-card-header {
  font-size: 15px; font-weight: 600; color: #F1F5F9;
  margin-bottom: 16px; padding-bottom: 12px;
  border-bottom: 1px solid rgba(255,255,255,.05);
}

/* 暗色表格 */
.dark-table :deep(.ant-table) { background: transparent; color: #E2E8F0; }
.dark-table :deep(.ant-table-thead > tr > th) {
  background: rgba(255,255,255,.03) !important; color: #94A3B8;
  font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .3px;
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.dark-table :deep(.ant-table-tbody > tr > td) { border-bottom: 1px solid rgba(255,255,255,.03); color: #CBD5E1; }
.dark-table :deep(.ant-table-tbody > tr:hover > td) { background: rgba(255,140,66,.04) !important; }
.dark-table :deep(.ant-table-tbody > tr:last-child > td) { border-bottom: none; }
</style>

<template>
  <div class="dashboard">
    <!-- 统计卡片 -->
    <a-row :gutter="16" class="stats-row">
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" :bordered="false">
          <a-statistic title="用户总数" :value="stats.totalUsers" :value-style="{ color: '#f97316' }">
            <template #prefix><UserOutlined /></template>
          </a-statistic>
          <div class="stat-trend">较上周 <span class="up">+12%</span></div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" :bordered="false">
          <a-statistic title="今日活跃" :value="stats.activeToday" suffix="人" :value-style="{ color: '#52c41a' }">
            <template #prefix><RiseOutlined /></template>
          </a-statistic>
          <div class="stat-trend">较昨日 <span class="up">+5</span></div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" :bordered="false">
          <a-statistic title="课程总数" :value="stats.courses" suffix="门" :value-style="{ color: '#1890ff' }">
            <template #prefix><BookOutlined /></template>
          </a-statistic>
          <div class="stat-trend">已发布 <span>{{ stats.coursesPublished }} 门</span></div>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="12" :lg="6">
        <a-card class="stat-card" :bordered="false">
          <a-statistic title="系统日志" :value="stats.logs" suffix="条" :value-style="{ color: '#722ed1' }">
            <template #prefix><FileTextOutlined /></template>
          </a-statistic>
          <div class="stat-trend">今日新增 <span>{{ stats.logsToday }}</span></div>
        </a-card>
      </a-col>
    </a-row>

    <!-- 图表区 -->
    <a-row :gutter="16" style="margin-top: 16px">
      <a-col :span="24">
        <a-card title="用户增长趋势" :bordered="false">
          <v-chart :option="userChartOption" style="height: 360px" autoresize />
        </a-card>
      </a-col>
    </a-row>

    <a-row :gutter="16" style="margin-top: 16px">
      <a-col :span="14">
        <a-card title="最近操作日志" :bordered="false">
          <a-table :columns="logColumns" :data-source="recentLogs" :pagination="false" size="small" />
        </a-card>
      </a-col>
      <a-col :span="10">
        <a-card title="快捷操作" :bordered="false">
          <a-space direction="vertical" style="width: 100%" :size="12">
            <a-button type="primary" block @click="router.push('/users')">
              <TeamOutlined /> 用户管理
            </a-button>
            <a-button block @click="router.push('/settings')">
              <SettingOutlined /> 系统设置
            </a-button>
            <a-button block @click="router.push('/settings?tab=logs')">
              <FileTextOutlined /> 查看操作日志
            </a-button>
          </a-space>
        </a-card>
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
    { name: '新增用户', type: 'line', smooth: true, data: [12, 18, 15, 25, 22, 30, 28], color: '#f97316', areaStyle: { color: 'rgba(249,115,22,0.1)' } },
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
.dashboard { padding: 0; }
.stats-row { margin-bottom: 0; }
.stat-card { border-radius: 12px; }
.stat-card :deep(.ant-card-body) { padding: 20px 24px; }
.stat-trend { margin-top: 8px; font-size: 13px; color: #999; }
.stat-trend .up { color: #52c41a; font-weight: 500; }
</style>

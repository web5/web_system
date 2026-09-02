<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, watch } from 'vue'
// 按需引入：只注册实际用到的图表与组件，避免把整个 echarts 打进包里
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  DataZoomComponent,
  CanvasRenderer,
])

const emit = defineEmits<{
  /** 图表点击事件；下钻依赖它（如点某一阶段看失败明细） */
  chartClick: [params: { name: string; value: unknown }]
}>()

const props = withDefaults(
  defineProps<{
    /** ECharts 配置；变化时会整体重绘 */
    option: EChartsCoreOption
    height?: string
  }>(),
  { height: '260px' },
)

const el = ref<HTMLDivElement | null>(null)
const chart = shallowRef<echarts.ECharts | null>(null)

function render() {
  if (!el.value) return
  if (!chart.value) {
    chart.value = echarts.init(el.value)
    chart.value.on('click', (params: { name?: string; value?: unknown }) => {
      emit('chartClick', { name: String(params.name ?? ''), value: params.value })
    })
  }
  chart.value.setOption(props.option, true)
}

function onResize() {
  chart.value?.resize()
}

onMounted(() => {
  render()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart.value?.dispose()
  chart.value = null
})

watch(() => props.option, render, { deep: true })
</script>

<template>
  <div ref="el" :style="{ width: '100%', height }" />
</template>

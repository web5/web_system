<script setup lang="ts">
/**
 * 环境切换挂件（共享组件）
 *
 * 环境 = 微前端的加载维度：每个 envId 对应一个产物目录 /static/modules/<appKey>/<envId>/。
 * 切换后**整页重载**（location.reload）——环境改变整套产物与接口上下文，局部更新会新旧混杂。
 *
 * 使用方：
 *  - 基座 shell：直接挂在 App.vue（覆盖 portal / admin 等所有模块）
 *  - micro-app（admin / portal）：仅在**未被 shell 加载**（standalone 调试）时挂载，避免重复
 *
 * 数据来源：gateway 注入的 window.__MODULES_MANIFEST__
 *   { site?, env?, defaultEnv?, switchable?, envs?: [{ id, name }], byEnv? }
 * gateway 未产出 envs 前，dev 环境用兜底列表便于本地预览（生产不启用）。
 *
 * 设计依据：specs/deploy-console-domain-split/environment-design.md §5
 * 注意：本组件被 shell 与 micro-app 共用，样式只用 --ws-* token（不依赖宿主 app 局部变量）。
 */
import { ref, computed } from 'vue'
import { readManifest, reportEnvSwitch, resolveEnvId, ENV_STORAGE_KEY } from '../composables/env'

interface EnvItem {
  id: string
  name: string
}

interface ManifestShape {
  site?: string | null
  env?: string
  defaultEnv?: string
  switchable?: boolean
  envs?: EnvItem[]
}

/** 「常用」分区：pin 的环境（后续由 deploy_envs.pin / 最近使用驱动） */
const PINNED = ['dev', '1', '2']

const manifest = readManifest() as ManifestShape

/** dev 兜底：gateway 尚未返回 envs 时用于本地预览（生产不启用） */
const DEV_FALLBACK: EnvItem[] = [
  { id: 'dev', name: '主开发环境' },
  { id: '1', name: '联调环境' },
  { id: '2', name: '灰度验证' },
  { id: '3', name: '支付联调' },
  { id: '4', name: '订单重构' },
  { id: '5', name: '用户中心改造' },
  { id: '6', name: 'AI 模型切换' },
  { id: '7', name: '小程序联调' },
  { id: '8', name: '内容中枢调试' },
  { id: '9', name: '权限重构' },
  { id: '10', name: '知识库验证' },
  { id: '11', name: '报表需求' },
  { id: '12', name: '消息推送' },
  { id: '13', name: '会员体系' },
  { id: '14', name: '活动运营' },
  { id: '15', name: '数据迁移' },
  { id: '16', name: '性能优化' },
  { id: '17', name: '埋点验证' },
  { id: '18', name: '国际化' },
  { id: '19', name: '安全加固' },
  { id: '20', name: '移动端适配' },
]

const envs = computed<EnvItem[]>(() => {
  const fromManifest = Array.isArray(manifest.envs) ? manifest.envs : []
  if (fromManifest.length) return fromManifest
  return import.meta.env.DEV ? DEV_FALLBACK : []
})

/** prod 站点 switchable=false，不渲染挂件 */
const switchable = computed(() => {
  if (manifest.switchable === false) return false
  if (manifest.switchable === true && envs.value.length > 0) return true
  return import.meta.env.DEV && envs.value.length > 1
})

/** 与网关/后端同一套解析：localStorage > defaultEnv > dev（见 composables/env） */
const currentEnvId = ref<string>(resolveEnvId(manifest))

const open = ref(false)
const keyword = ref('')

const filtered = computed<EnvItem[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return envs.value.filter(
    (e) => !kw || e.id.toLowerCase().includes(kw) || e.name.toLowerCase().includes(kw),
  )
})
const pinned = computed(() => filtered.value.filter((e) => PINNED.includes(e.id)))
const rest = computed(() => filtered.value.filter((e) => !PINNED.includes(e.id)))

function openDialog() {
  keyword.value = ''
  open.value = true
}

async function choose(e: EnvItem) {
  if (e.id === currentEnvId.value) {
    open.value = false
    return
  }
  open.value = false
  localStorage.setItem(ENV_STORAGE_KEY, e.id)
  // 审计上报（Q110）：先尝试上报，但**不阻断切换** —— 最多等 800ms 即重载
  await Promise.race([
    reportEnvSwitch(e.id, manifest.site || undefined),
    new Promise((r) => setTimeout(r, 800)),
  ])
  // 整页重载：环境切换改变整套产物与接口上下文
  window.location.reload()
}
</script>

<template>
  <div v-if="switchable" class="env-switcher">
    <button class="env-pill" type="button" @click="openDialog">
      <span class="dot" aria-hidden="true"></span>
      <span class="label">环境</span>
      <b class="eid">{{ currentEnvId }}</b>
      <span class="caret">切换</span>
    </button>

    <Teleport to="body">
      <div v-if="open" class="env-mask" @click.self="open = false">
        <div class="env-dialog" role="dialog" aria-label="切换加载环境">
          <header class="dialog-head">
            <h3>切换加载环境</h3>
            <div class="hd-right">
              <span class="cur">当前 <b>{{ currentEnvId }}</b></span>
              <button class="close" type="button" @click="open = false">×</button>
            </div>
          </header>

          <div class="dialog-search">
            <input v-model="keyword" placeholder="搜索环境 ID / 名称" />
          </div>

          <div class="dialog-list">
            <template v-if="pinned.length">
              <div class="sec">常用</div>
              <div
                v-for="e in pinned"
                :key="e.id"
                class="row"
                :class="{ on: e.id === currentEnvId }"
                @click="choose(e)"
              >
                <span class="eid">{{ e.id }}</span>
                <span class="ename">{{ e.name }}</span>
                <span class="ecur">{{ e.id === currentEnvId ? '当前' : '' }}</span>
              </div>
            </template>

            <div class="sec">全部环境（{{ filtered.length }}）</div>
            <div
              v-for="e in rest"
              :key="e.id"
              class="row"
              :class="{ on: e.id === currentEnvId }"
              @click="choose(e)"
            >
              <span class="eid">{{ e.id }}</span>
              <span class="ename">{{ e.name }}</span>
              <span class="ecur">{{ e.id === currentEnvId ? '当前' : '' }}</span>
            </div>
            <div v-if="!filtered.length" class="empty">没有匹配的环境</div>
          </div>

          <footer class="dialog-foot">
            共 {{ envs.length }} 个环境 · 切换后整页重载，确保模块与接口上下文一致
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 挂件：右下角常驻（dev / local 站点），prod 不渲染 */
.env-switcher {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 1080;
}
.env-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--ws-bg-container, #fff);
  border: 1px solid var(--ws-border, #e8ebf0);
  border-radius: 22px;
  padding: 7px 14px 7px 11px;
  box-shadow: 0 6px 22px rgba(20, 30, 50, 0.14);
  cursor: pointer;
  font-size: 12px;
  color: var(--ws-text-secondary, #5b6372);
}
.env-pill:hover {
  border-color: var(--ws-brand-300, #ffd0ab);
}
.env-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ws-brand-500, #f97316);
}
.env-pill .eid {
  color: var(--ws-brand-500, #f97316);
  font-weight: 700;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.env-pill .caret {
  color: var(--ws-text-tertiary, #9aa1ad);
}

/* 大弹窗：覆盖当前页面，容纳几十个环境 */
.env-mask {
  position: fixed;
  inset: 0;
  background: rgba(20, 30, 50, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1090;
}
.env-dialog {
  width: 680px;
  max-height: 620px;
  background: var(--ws-bg-container, #fff);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 70px rgba(20, 30, 50, 0.32);
}
.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 17px 22px 13px;
  border-bottom: 1px solid var(--ws-border-light, #f0f2f6);
}
.dialog-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--ws-text-primary, #1a1f2e);
}
.hd-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hd-right .cur {
  font-size: 12px;
  color: var(--ws-text-tertiary, #9aa1ad);
}
.hd-right .cur b {
  color: var(--ws-brand-500, #f97316);
  font-family: ui-monospace, Menlo, monospace;
}
.hd-right .close {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid var(--ws-border, #e8ebf0);
  background: transparent;
  color: var(--ws-text-tertiary, #9aa1ad);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0;
}
.dialog-search {
  padding: 12px 22px;
  border-bottom: 1px solid var(--ws-border-light, #f0f2f6);
}
.dialog-search input {
  width: 100%;
  border: 1px solid var(--ws-border, #e8ebf0);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  outline: none;
  color: var(--ws-text-primary, #1a1f2e);
  background: transparent;
}
.dialog-search input:focus {
  border-color: var(--ws-brand-300, #ffd0ab);
}
.dialog-list {
  flex: 1;
  overflow: auto;
  padding: 6px 12px 12px;
}
.sec {
  padding: 10px 10px 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ws-text-tertiary, #9aa1ad);
  position: sticky;
  top: 0;
  background: var(--ws-bg-container, #fff);
}
.row {
  display: grid;
  grid-template-columns: 74px 1fr 52px;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 9px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ws-text-secondary, #5b6372);
}
.row:hover {
  background: var(--ws-bg-hover, #f5f7fa);
}
.row.on {
  background: var(--ws-brand-50, #fff1e7);
}
/* ID 前置：避免不同环境重名导致选错 */
.eid {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--ws-text-primary, #1a1f2e);
  background: var(--ws-bg-hover, #f5f7fa);
  border: 1px solid var(--ws-border, #e8ebf0);
  border-radius: 6px;
  padding: 2px 7px;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row.on .eid {
  color: #fff;
  background: var(--ws-brand-500, #f97316);
  border-color: var(--ws-brand-500, #f97316);
}
.ename {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row.on .ename {
  color: var(--ws-brand-500, #f97316);
  font-weight: 600;
}
.ecur {
  font-size: 11px;
  font-weight: 600;
  color: var(--ws-brand-500, #f97316);
  text-align: right;
}
.empty {
  padding: 40px;
  text-align: center;
  font-size: 13px;
  color: var(--ws-text-tertiary, #9aa1ad);
}
.dialog-foot {
  padding: 12px 22px;
  border-top: 1px solid var(--ws-border-light, #f0f2f6);
  font-size: 12px;
  color: var(--ws-text-tertiary, #9aa1ad);
}
</style>

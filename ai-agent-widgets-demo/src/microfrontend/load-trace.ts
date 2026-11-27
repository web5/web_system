// 加载时序可视化的数据源（模块级 reactive 单例；基座与 LoadTrace 共用同一份）
import { ref } from 'vue';

export type TraceStatus = 'ok' | 'pending' | 'error';

/** 规范化的 7 步加载管线，LoadTrace 顶部用状态灯逐格展示。 */
export const LOAD_PHASES = [
  { key: 'detect', title: '检测 widget 声明' },
  { key: 'whitelist', title: '白名单校验' },
  { key: 'import', title: "System.import('poll')" },
  { key: 'register', title: 'register' },
  { key: 'vue', title: '共享 vue 注入' },
  { key: 'mount', title: 'mount' },
  { key: 'ready', title: 'ready' },
] as const;

export type PhaseKey = (typeof LOAD_PHASES)[number]['key'];

export interface TraceEntry {
  seq: number;
  at: string;
  slotId: string;
  app: string;
  phase: string;
  label: string;
  status: TraceStatus;
}

const MAX_ENTRIES = 240;
const entries = ref<TraceEntry[]>([]);
let seq = 0;

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function trace(
  slotId: string,
  app: string,
  phase: string,
  label: string,
  status: TraceStatus = 'ok',
): void {
  entries.value.push({ seq: ++seq, at: timestamp(), slotId, app, phase, label, status });
  if (entries.value.length > MAX_ENTRIES) {
    entries.value.splice(0, entries.value.length - MAX_ENTRIES);
  }
}

/** 卸载三连：unmount → bus 解绑 → slot 释放。 */
export function traceUnmount(slotId: string, app: string): void {
  trace(slotId, app, 'unmount', 'app.unmount() 销毁子应用 Vue 实例');
  trace(slotId, app, 'bus-unbind', 'aguiBus.off() 精确解绑监听');
  trace(slotId, app, 'slot-release', 'Map<slotId, handle> 删除，slot 释放');
}

export function useLoadTrace() {
  return {
    entries,
    phases: LOAD_PHASES,
    clear: () => {
      entries.value = [];
    },
  };
}

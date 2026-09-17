/**
 * service action 的「tool 名 → 平台内置能力」映射（design §3 终态）。
 *
 * 终态要求：**节点只有 shell / approval 两类**，平台能力（写版本、切指针…）
 * 不再是节点类型，而是 shell 节点里的一个 `service` action ——
 * 这样既满足"节点只有两类"，又不丢平台语义。
 *
 * 命名约定：tool 名用**动作语义**（write-version / switch-pointer），
 * 与之对应的内置执行体（version / pointer / …）是历史命名，两者在这里对上。
 */
export const SERVICE_TOOL_TO_STEP: Readonly<Record<string, string>> = {
  'write-version': 'version',
  'switch-pointer': 'pointer',
  restart: 'restart',
  // 方案 A（2026-09-17）：后台「部署生效」—— 版本目录 → dist + 重启 + 切指针，
  // 让流水线跑完即生效（此前跑完还得人工去控制台点「部署」，且不可回滚）
  'apply-version': 'apply',
  verify: 'verify',
  upload: 'upload',
  pull: 'pull',
  cleanup: 'cleanup',
  check: 'check',
};

/** 该 tool 名对应的内置步骤 key（未知返回 null） */
export function resolveServiceStep(tool?: string | null): string | null {
  if (!tool) return null;
  return SERVICE_TOOL_TO_STEP[tool] ?? null;
}

/** 展示用的可用 tool 列表（编辑器下拉用） */
export const SERVICE_TOOL_OPTIONS: ReadonlyArray<{ tool: string; label: string }> = [
  { tool: 'write-version', label: '写版本记录' },
  { tool: 'switch-pointer', label: '切换版本指针' },
  { tool: 'restart', label: '重启服务' },
  { tool: 'apply-version', label: '部署生效（后台：版本目录 → dist + 重启 + 切指针）' },
  { tool: 'verify', label: '部署验证' },
  { tool: 'upload', label: '投递产物' },
  { tool: 'pull', label: '拉取代码' },
  { tool: 'cleanup', label: '清理旧版本' },
  { tool: 'check', label: '安全基线校验' },
];

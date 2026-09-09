import { BadRequestException } from '@nestjs/common';
import { PIPELINE_STAGES } from '../entities/deploy-pipeline.entity';

/** 内置 9 阶段 → script 节点的默认 label（转存 legacy 模板用） */
const LEGACY_SCRIPT_LABELS: Record<string, string> = {
  check: '校验',
  build: '构建',
  upload: '投递',
  restart: '重启',
  verify: '探活',
  cleanup: '清理',
};

/**
 * v5 模板节点模型与校验（PIPELINE_V5_NODES）。
 *
 * 节点 = 流水线的组成单元，取代 v4 固定 9 阶段：
 *  - platform：git 拉码 / version 写版本 / pointer 切指针 —— 发布语义真相源，不可编辑/增删
 *  - script：用户自定义节点（build/verify/notify…），可增删排序，脚本存模块级 stage_commands
 */

/** 平台保留字（不可被 script 节点占用，也不允许作为 stage_commands key 写入） */
export const PLATFORM_RESERVED = ['git', 'version', 'pointer'] as const;

export type PlatformKey = (typeof PLATFORM_RESERVED)[number];

export interface PlatformNode {
  kind: 'platform';
  key: PlatformKey;
  label?: string;
}

export interface ScriptNode {
  kind: 'script';
  /** 节点唯一 key（也是模块 stage_commands 的 stage） */
  key: string;
  label: string;
  /** 未配脚本：默认 false=必配 fail-fast；true=跳过+warning */
  optional?: boolean;
  /** 该节点失败触发自动回滚（取代"仅 verify 触发"） */
  watchdog?: boolean;
  /** 节点级默认超时（可被模块 actions 覆盖） */
  timeoutSec?: number;
}

export type TemplateNode = PlatformNode | ScriptNode;

/** script 节点 key 格式 */
const SCRIPT_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * 归一化模板节点（纯函数）。
 * null/空 → null（= legacy：沿用 steps 子集语义，引擎走 PIPELINE_STAGES）。
 * 校验规则（design §14.5）：
 *   1) 三个 platform 节点必须存在；git 必须首位；相对序 git→version→pointer 不可逆；
 *   2) script key 唯一、不与 platform 保留字冲突、匹配 ^[A-Za-z0-9_-]{1,32}$；
 *   3) watchdog 最多 1 个；
 *   4) script 需有非空 label。
 */
export function normalizeNodes(
  nodes?: (TemplateNode | null | undefined)[] | null,
): TemplateNode[] | null {
  if (!nodes || nodes.length === 0) return null;
  const list = nodes.filter((n): n is TemplateNode => !!n);
  if (list.length === 0) return null;

  // platform 必须齐全
  const keys = list.map((n) => n.key);
  for (const reserved of PLATFORM_RESERVED) {
    if (!keys.includes(reserved)) {
      throw new BadRequestException(`节点必须保留平台步骤「${reserved}」（发布语义基线，不可裁剪）`);
    }
  }
  // 相对序 git → version → pointer
  const idxOf = (k: string) => keys.indexOf(k);
  if (idxOf('git') !== 0) throw new BadRequestException('「git」必须排在第一位（先拉码后构建）');
  if (idxOf('version') > idxOf('pointer')) {
    throw new BadRequestException('「version」必须排在「pointer」之前（先写版本后切指针）');
  }
  // key 唯一 + script 合法性
  const seen = new Set<string>();
  let watchdogCount = 0;
  for (const n of list) {
    if (seen.has(n.key)) throw new BadRequestException(`节点 key 重复: ${n.key}`);
    seen.add(n.key);
    if (n.kind === 'platform') {
      continue;
    }
    // script
    if (PLATFORM_RESERVED.includes(n.key as any)) {
      throw new BadRequestException(`script 节点 key 不能占用平台保留字: ${n.key}`);
    }
    if (!SCRIPT_KEY_RE.test(n.key)) {
      throw new BadRequestException(`script 节点 key 非法: ${n.key}（须匹配 ^[A-Za-z0-9_-]{1,32}$）`);
    }
    if (!n.label?.trim()) throw new BadRequestException(`script 节点「${n.key}」缺少 label`);
    if (n.watchdog) watchdogCount++;
  }
  if (watchdogCount > 1) throw new BadRequestException('watchdog 节点最多 1 个');
  return list;
}

/** v5 nodes 模式是否开启（缺省 off = legacy 9 阶段路径） */
export function isV5NodesEnabled(): boolean {
  return (process.env.PIPELINE_V5_NODES ?? 'off').toLowerCase() === 'on';
}

/**
 * stage_commands 可写 key 判定：任意非 platform 保留字、格式合法的 script key。
 * 用于放开 CONFIGURABLE_STAGES 白名单（v5：节点集合开放，脚本按「模块 × 节点 key」配置）。
 */
export function isWritableStageKey(stage: string): boolean {
  if (!stage) return false;
  if ((PLATFORM_RESERVED as readonly string[]).includes(stage)) return false;
  return SCRIPT_KEY_RE.test(stage);
}

/** 各模块类型默认构建 script 节点（转存 legacy 时生成的 script 节点 key） */
const BUILTIN_SCRIPT_KEYS = ['check', 'build', 'upload', 'restart', 'verify', 'cleanup'] as const;

/**
 * legacy 模板（steps 子集 / skipVerify / 九阶段常量）→ v5 nodes 一次性转存（纯函数）。
 *
 * 规则（design §14.3.1/§14.5）：
 *  - git/version/pointer → platform（git 首位，version→pointer 保序）；git 取代 legacy 的 pull 语义
 *  - 其余（check/build/upload/restart/verify/cleanup，按原 steps 是否启用）→ script 节点，
 *    label 用内置中文名；key 沿用 legacy 阶段名（其脚本仍在模块级 stage_commands[key]，零迁移）
 *  - legacy 含 verify 且 rollbackOnFailure='previous' → 该 verify 节点标 watchdog=true（保留自动回滚）
 *  - skipVerify / steps 裁掉 verify → 不生成 verify 节点（= 放弃自动回滚，与 legacy skipVerify 语义一致）
 *
 * 返回的 nodes 已满足 normalizeNodes 约束；若 legacy steps 为空（全量）且 skipVerify 则剔除 verify。
 */
export function legacyStepsToNodes(opts: {
  steps?: string[] | null;
  skipVerify?: boolean;
  rollbackOnFailure?: 'previous' | 'none';
}): TemplateNode[] {
  const base = opts.steps && opts.steps.length ? [...opts.steps] : [...PIPELINE_STAGES];
  const withVerify = !opts.skipVerify && base.includes('verify');
  const verifyWatchdog = withVerify && opts.rollbackOnFailure !== 'none';

  const nodes: TemplateNode[] = [];
  nodes.push({ kind: 'platform', key: 'git' }); // git 恒首位
  for (const s of base) {
    if (s === 'pull' || s === 'git') continue; // pull 已被 platform/git 取代
    if (s === 'version') {
      nodes.push({ kind: 'platform', key: 'version' });
      continue;
    }
    if (s === 'pointer') {
      nodes.push({ kind: 'platform', key: 'pointer' });
      continue;
    }
    if (s === 'verify' && !withVerify) continue; // skipVerify / 被裁剪
    if (!(BUILTIN_SCRIPT_KEYS as readonly string[]).includes(s as any)) continue;
    const optional =
      s === 'build'
        ? false // build：legacy required 语义，未配即 fail-fast
        : true; // check 基线已上提 submit / upload/restart/verify/cleanup 未配先 optional 跳过（11.7 实发校准）
    nodes.push({
      kind: 'script',
      key: s,
      label: LEGACY_SCRIPT_LABELS[s] ?? s,
      optional,
      watchdog: s === 'verify' && verifyWatchdog ? true : undefined,
    });
  }
  // 双保险：确保 version 不在 pointer 之后（相对序硬约束）
  const ver = nodes.findIndex((n) => n.key === 'version');
  const ptr = nodes.findIndex((n) => n.key === 'pointer');
  if (ver >= 0 && ptr >= 0 && ver > ptr) {
    const [v] = nodes.splice(ver, 1);
    nodes.splice(ptr, 0, v);
  }
  return nodes;
}

/** 节点执行计划（纯函数产物，engine run/executeStage 共用；nodes 为 null 时返回 null=legacy） */
export interface NodeRunPlan {
  /** 保序的节点 key（git/version/pointer + script 自定义 key 按编排序） */
  keys: string[];
  /** watchdog script 节点的 key（无则为 undefined）——该节点失败触发自动回滚 */
  watchKey?: string;
  /** script 节点 key 集合（platform 之外的都可写） */
  scriptKeys: Set<string>;
}

/**
 * 由模板/实例 nodes 解析执行计划（纯函数）。
 * nodes 为 null/空 → null（调用方走 legacy：PIPELINE_STAGES/steps 子集）。
 */
export function resolveNodeRunPlan(nodes?: TemplateNode[] | null): NodeRunPlan | null {
  if (!nodes || nodes.length === 0) return null;
  const keys = nodes.map((n) => n.key);
  const scriptKeys = new Set<string>();
  let watchKey: string | undefined;
  for (const n of nodes) {
    if (n.kind !== 'script') continue;
    scriptKeys.add(n.key);
    if (n.watchdog && !watchKey) watchKey = n.key;
  }
  return { keys, watchKey, scriptKeys };
}

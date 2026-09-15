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
 * 模板节点模型与校验（PIPELINE_V5_NODES）。
 *
 * **终态（design §3）**：节点只有**两类** ——
 *  - `shell`：跑命令的节点（拉代码 / 构建 / 发布…），可增删排序、可拖动；
 *    平台能力（写版本 / 切指针 / 重启 / 验证…）**不再是节点类型**，
 *    而是 shell 节点里的一个 `service` action（见 `steps/service-tools.ts`）。
 *  - `approval`：审批节点（design D8），执行到它挂起、批准后从其后继续。
 *
 * 兼容读取：存量模板里还有 `platform`（git/version/pointer）与旧名 `script` 节点，
 * 迁移完成前引擎仍需能跑它们（T5 数据迁移负责转换）。
 *  - `script` = `shell` 的旧名，语义相同，新写入一律用 `shell`；
 *  - `platform` 仅作为**读取兼容**保留，`normalizeNodes` 不再强制要求它们存在。
 */

/**
 * 不再允许作为**节点 key** 的保留字。
 *
 * `git` 已放开：拉码在终态就是普通 shell 节点（脚本 = 平台托管的 git-step.sh）。
 * `version` / `pointer` 保留：它们的能力已变成 `service` action，
 * 若再出现同名节点会造成"以为它在写版本/切指针"的语义误读。
 */
export const PLATFORM_RESERVED = ['version', 'pointer'] as const;

export type PlatformKey = (typeof PLATFORM_RESERVED)[number];

/** 终态：shell 节点（跑命令）。`actions` 由节点命令表提供，节点本身只描述结构与语义 */
export interface ShellNode {
  kind: 'shell';
  /** 节点唯一 key（同时是「模板 × 节点 key」命令配置的键名） */
  key: string;
  label: string;
  /** 未配命令：默认 false=必配 fail-fast；true=跳过+warning */
  optional?: boolean;
  /** 该节点失败触发自动回滚（全局最多 1 个） */
  watchdog?: boolean;
  /** 节点级默认超时（可被 action 覆盖） */
  timeoutSec?: number;
}

/**
 * 旧名节点（= shell，历史数据与旧前端仍在写）。
 * @deprecated 新写入请用 `kind: 'shell'`；两者引擎行为一致。
 */
export interface ScriptNode {
  kind: 'script';
  key: string;
  label: string;
  optional?: boolean;
  watchdog?: boolean;
  timeoutSec?: number;
}

/**
 * 平台节点（**仅读取兼容**）。
 * @deprecated 终态不再有 platform 节点：git → shell 节点；version/pointer → service action。
 */
export interface PlatformNode {
  kind: 'platform';
  key: string;
  label?: string;
}

/**
 * 审批节点（design D8：审批由「发布前置门禁」升级为**节点**）。
 *
 * 可插在任意位置（如 build 之后、restart 之前），执行到它时流水线挂起，
 * 批准后**从该节点之后继续**，已完成的 shell 节点不重跑。
 * 与 shell 节点共享 key/label 约束，但不参与 watchdog 计数（无可失败语义）。
 */
export interface ApprovalNode {
  kind: 'approval';
  /** 节点唯一 key（挂起态的恢复锚点，落 deploy_approvals.nodeKey） */
  key: string;
  label: string;
  /** 指定审批人；空 = 任意有审批权限者 */
  approvers?: string[];
  /** 超时秒数；未配置 = 不超时（等人工处理） */
  timeoutSec?: number;
  /** 超时未批的处理：abort=失败终止（默认）/ auto-approve=自动通过 */
  onTimeout?: ApprovalTimeoutAction;
  /** 拒绝的处理：abort=失败终止（默认）/ rollback=回滚 */
  onReject?: ApprovalRejectAction;
}

export const APPROVAL_TIMEOUT_ACTIONS = ['abort', 'auto-approve'] as const;
export const APPROVAL_REJECT_ACTIONS = ['abort', 'rollback'] as const;
export type ApprovalTimeoutAction = (typeof APPROVAL_TIMEOUT_ACTIONS)[number];
export type ApprovalRejectAction = (typeof APPROVAL_REJECT_ACTIONS)[number];

export type TemplateNode = ShellNode | ScriptNode | ApprovalNode | PlatformNode;

/** shell / script / approval 节点 key 格式 */
const SCRIPT_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** 节点是否可承载命令（approval 是纯等待语义，不配脚本） */
export function isCommandNode(node: TemplateNode): boolean {
  return node.kind === 'shell' || node.kind === 'script';
}

/** 节点类型的中文展示名（错误提示用） */
function kindLabelOf(node: TemplateNode): string {
  if (node.kind === 'approval') return 'approval';
  if (node.kind === 'platform') return 'platform（旧）';
  return 'shell';
}

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

  // key 唯一 + shell / approval 合法性
  // 终态不再强制 git/version/pointer 三节点（平台能力已变成 service action），
  // 也不再约束它们的相对序 —— 顺序由用户在画布上拖拽决定。
  const seen = new Set<string>();
  let watchdogCount = 0;
  for (const n of list) {
    if (seen.has(n.key)) throw new BadRequestException(`节点 key 重复: ${n.key}`);
    seen.add(n.key);
    if (n.kind === 'platform') {
      // 旧节点：读取兼容，不校验 label（历史数据无 label）
      continue;
    }
    // shell（含旧名 script）/ approval 共用 key 与 label 约束
    const kindLabel = kindLabelOf(n);
    if (PLATFORM_RESERVED.includes(n.key as any)) {
      throw new BadRequestException(
        `${kindLabel} 节点 key 不能占用保留字: ${n.key}（其能力已是 service action，不应用作节点名）`,
      );
    }
    if (!SCRIPT_KEY_RE.test(n.key)) {
      throw new BadRequestException(
        `${kindLabel} 节点 key 非法: ${n.key}（须匹配 ^[A-Za-z0-9_-]{1,32}$）`,
      );
    }
    if (!n.label?.trim()) throw new BadRequestException(`${kindLabel} 节点「${n.key}」缺少 label`);
    if (n.kind === 'approval') {
      // 审批节点不承载命令、无失败语义 → 不占用 watchdog 唯一性
      if (
        n.onReject &&
        !(APPROVAL_REJECT_ACTIONS as readonly string[]).includes(n.onReject)
      ) {
        throw new BadRequestException(
          `approval 节点「${n.key}」onReject 非法: ${n.onReject}（可选 ${APPROVAL_REJECT_ACTIONS.join(' / ')}）`,
        );
      }
      if (
        n.onTimeout &&
        !(APPROVAL_TIMEOUT_ACTIONS as readonly string[]).includes(n.onTimeout)
      ) {
        throw new BadRequestException(
          `approval 节点「${n.key}」onTimeout 非法: ${n.onTimeout}（可选 ${APPROVAL_TIMEOUT_ACTIONS.join(' / ')}）`,
        );
      }
      continue;
    }
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
  // git 恒首位：终态它就是普通 shell 节点（脚本 = 平台托管的 git-step.sh）
  nodes.push({ kind: 'shell', key: 'git', label: '拉取代码' });
  for (const s of base) {
    if (s === 'pull' || s === 'git') continue; // pull 已被 git 节点取代
    // version / pointer：终态不再作为节点 —— 写版本是发布节点里的 service action，
    // 切指针归「模块管理 → 环境部署」的人工动作，都不该出现在流水线编排里
    if (s === 'version' || s === 'pointer') continue;
    if (s === 'verify' && !withVerify) continue; // skipVerify / 被裁剪
    if (!(BUILTIN_SCRIPT_KEYS as readonly string[]).includes(s as any)) continue;
    const optional =
      s === 'build'
        ? false // build：legacy required 语义，未配即 fail-fast
        : true; // check 基线已上提 submit / upload/restart/verify/cleanup 未配先 optional 跳过（11.7 实发校准）
    nodes.push({
      kind: 'shell',
      key: s,
      label: LEGACY_SCRIPT_LABELS[s] ?? s,
      optional,
      watchdog: s === 'verify' && verifyWatchdog ? true : undefined,
    });
  }
  return nodes;
}

/**
 * 模板级审批人下沉到approval 节点（纯函数）。
 *
 * 节点未指定 `approvers` 时继承模板级配置；节点显式指定则以节点为准（更具体优先）。
 * 提交时调用，结果随实例 nodes 快照，模板后续改动不影响历史实例。
 */
export function applyTemplateApprovers(
  nodes: TemplateNode[] | null | undefined,
  tplApprovers?: string[] | null,
): TemplateNode[] | null {
  if (!nodes || !nodes.length) return nodes ?? null;
  const fallback = [
    ...new Set((tplApprovers ?? []).map((s) => String(s ?? '').trim()).filter(Boolean)),
  ];
  if (!fallback.length) return nodes;
  return nodes.map((n) =>
    n.kind === 'approval' && !(n.approvers ?? []).length ? { ...n, approvers: [...fallback] } : n,
  );
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
    if (!isCommandNode(n)) continue;
    scriptKeys.add(n.key);
    if (isCommandNode(n) && (n as ShellNode).watchdog && !watchKey) watchKey = n.key;
  }
  return { keys, watchKey, scriptKeys };
}

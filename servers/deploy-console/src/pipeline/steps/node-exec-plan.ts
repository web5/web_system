import { TemplateNode } from '../../pipeline-template/template-node';

/**
 * v5 节点执行策略（纯函数，便于单测）。
 *
 * 把「某个节点该怎么执行」从引擎里抽出来，源于两个真实踩坑：
 *
 * 1) **check 必须恒内置执行**：v5 把 legacy 模板懒转存为节点后，`check` 是
 *    `optional=true` 的 script 节点；DB 无 `check` 命令时整段跳过 →
 *    `reuseArtifact`（复用产物）/ 分支缺省 `master` / `prod` 分支约束**全部丢失**
 *    （实测流水线日志 `[check] 校验 未配置脚本，已跳过（optional）`、`reuse_artifact=0`）。
 *    故 check 走「内置安全基线 + 命令叠加」，与 legacy `commandMode='base'` 对齐。
 *
 * 2) **git 要支持 DB 锁定脚本 + 内置回退**：平台托管脚本（`locked`）优先执行，
 *    模板未 seed 时回退内置 `PullExecutor`；两者之后都由平台回填版本（见 resolveGitIdentity）。
 */
export type NodeExecPlan =
  /** check：安全基线恒内置执行，DB 命令作为附加校验叠加 */
  | { how: 'check-base' }
  /** 普通 script 节点：命令驱动（未配命令按 optional 跳过或 fail-fast） */
  | { how: 'script' }
  /** git：DB 锁定脚本优先，缺省回退内置 pull，之后由平台回填版本 */
  | { how: 'git' }
  /** version / pointer：发布语义真相源，纯内置，不可被命令覆盖 */
  | { how: 'builtin'; builtinKey: string };

/** 解析节点执行策略（纯函数） */
export function planNodeExec(node: TemplateNode): NodeExecPlan {
  if (node.kind === 'platform') {
    if (node.key === 'git') return { how: 'git' };
    return { how: 'builtin', builtinKey: node.key };
  }
  if (node.key === 'check') return { how: 'check-base' };
  return { how: 'script' };
}

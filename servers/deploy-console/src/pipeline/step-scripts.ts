import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * 平台托管脚本（`deploy_pipeline_step_commands.locked=true` 的正文来源）。
 *
 * 为什么放代码而不是 SQL 迁移：
 * - **两端一致**：脚本随 console 版本走，本机与 dev 机各自启动时幂等同步，不会出现
 *   "SQL 迁移漏跑导致两台机器脚本不同"的漂移；
 * - **可校验**：脚本是真实 `.sh` 文件，可 `bash -n` 做语法校验（见 spec）；
 * - **可重置**：平台托管语义 = 代码是真相源，手工改库会在下次启动/提交时被重置。
 *
 * 落盘方式：`nest-cli.json` 已把 `pipeline/scripts/*.sh` 作为构建资产拷贝到 dist，
 * 运行期与测试期（ts-jest）都用 `__dirname/scripts/<name>` 读取。
 */

/** git 拉取脚本文件名（`src/pipeline/scripts/git-step.sh`） */
export const GIT_STEP_SCRIPT_FILE = 'git-step.sh';
/** restart 阶段脚本文件名（`src/pipeline/scripts/restart-step.sh`） */
export const RESTART_STEP_SCRIPT_FILE = 'restart-step.sh';
/** verify 阶段脚本文件名（`src/pipeline/scripts/verify-step.sh`） */
export const VERIFY_STEP_SCRIPT_FILE = 'verify-step.sh';

/**
 * 平台托管脚本清单：`nodeKey` 固定为 v5 platform 节点名。
 *
 * restart / verify 自 2026-09-14 起纳入托管。此前它们是 `locked=0` 的用户自配节点，
 * 内容只存在 DB —— 换机器 / 重置库 / 另一端 console 都会与 master 的脚本漂移
 * （正是注释里点名的"SQL 迁移漏跑导致两台机器脚本不同"）。
 * 纳入后：随 console 版本幂等同步到各环境，页面只读，可 `bash -n` 校验。
 *
 * 两者都只做「委托」——实现留在仓库 `scripts/pipeline/` 下随业务代码走，
 * 改实现不必动库，改「调用谁」才动库。
 */
export const PLATFORM_STEP_SCRIPTS: ReadonlyArray<{ nodeKey: string; file: string; label: string }> = [
  { nodeKey: 'git', file: GIT_STEP_SCRIPT_FILE, label: '拉取代码（平台托管）' },
  { nodeKey: 'restart', file: RESTART_STEP_SCRIPT_FILE, label: '重启服务（平台托管）' },
  { nodeKey: 'verify', file: VERIFY_STEP_SCRIPT_FILE, label: '部署验证（平台托管）' },
];

/**
 * 平台脚本目录（运行期绝对路径）。
 *
 * 供 `restart-step.sh` / `verify-step.sh` 定位随 console 分发的实现脚本
 * （引擎通过 `WS_PLATFORM_SCRIPTS_DIR` 变量注入）—— 实现收归 console 后，
 * 流水线不再依赖发布分支里的 `scripts/pipeline/*.sh`。
 */
export function platformScriptsDir(): string {
  return join(__dirname, 'scripts');
}

/** 读取脚本正文（缺失时抛错：宁可启动报错，也不要静默用空脚本发布） */
export function readStepScript(fileName: string): string {
  const file = join(__dirname, 'scripts', fileName);
  if (!existsSync(file)) {
    throw new Error(`平台托管脚本缺失: ${file}（检查 nest-cli.json 的 assets 配置与构建产物）`);
  }
  return readFileSync(file, 'utf-8');
}

/** 取某个平台托管步骤的脚本正文 */
export function getPlatformStepScript(nodeKey: string): string {
  const item = PLATFORM_STEP_SCRIPTS.find((s) => s.nodeKey === nodeKey);
  if (!item) throw new Error(`未知的平台托管步骤: ${nodeKey}`);
  return readStepScript(item.file);
}

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

/** 平台托管脚本清单：`nodeKey` 固定为 v5 platform 节点名 */
export const PLATFORM_STEP_SCRIPTS: ReadonlyArray<{ nodeKey: string; file: string; label: string }> = [
  { nodeKey: 'git', file: GIT_STEP_SCRIPT_FILE, label: '拉取代码（平台托管）' },
];

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

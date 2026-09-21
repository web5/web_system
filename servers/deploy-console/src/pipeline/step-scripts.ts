import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * 平台托管脚本 / 默认脚本的正文来源（`deploy_pipeline_step_commands`）。
 *
 * 为什么放代码而不是 SQL 迁移：
 * - **两端一致**：脚本随 console 版本走，本机与 dev 机各自启动时幂等同步，不会出现
 *   "SQL 迁移漏跑导致两台机器脚本不同"的漂移；
 * - **可校验**：脚本是真实 `.sh` 文件，可 `bash -n` 做语法校验（见 spec）；
 * - **可重置**：平台托管语义 = 代码是真相源，手工改库会在下次启动/提交时被重置。
 *
 * 落盘方式：`nest-cli.json` 已把 `pipeline/scripts/*` 作为构建资产拷贝到 dist，
 * 运行期与测试期（ts-jest）都用 `__dirname/scripts/<name>` 读取。
 */

/** git 拉取脚本文件名（`src/pipeline/scripts/git-step.sh`） */
export const GIT_STEP_SCRIPT_FILE = 'git-step.sh';

/**
 * 平台托管脚本清单：`nodeKey` 固定为 v5 platform 节点名。
 *
 * **2026-09-21 起为空**（用户决定，见 `specs/pipeline-restart-verify-as-action/design.md`）：
 * restart / verify 原先由本清单托管（代码是真相源、启动/提交时覆盖 DB、页面只读），
 * 但它们同时又是「孤儿命令」——模板里没有对应节点，从不执行；真正让服务生效的是
 * 控制台「部署」接口里的平台代码。现按要求把这两个动作**下沉为发布流水线里的 DB action 脚本**
 * （可用 `CONSOLE_API` + `CONSOLE_TOKEN` 调 `/api/internal/release/*` 写版本/切指针），
 * 代码不再托管、不再覆盖 DB。
 *
 * 机制保留：将来若要重新托管某个节点的脚本，往本清单加一条 + 放一个 `.sh` 即可
 * （`PlatformScriptSeedService` 是数据驱动的，清单为空时它什么都不做）。
 */
export const PLATFORM_STEP_SCRIPTS: ReadonlyArray<{ nodeKey: string; file: string; label: string }> =
  [];

/**
 * **默认节点脚本**（一次性初始值，不是平台托管）。
 *
 * 与 `PLATFORM_STEP_SCRIPTS` 的区别：这里只在节点命令**不存在**时写入一次，且 `locked=false`
 * —— 之后由运维在页面上改，平台不再覆盖（用户 2026-09-15：拉取代码也是自定义节点）。
 */
export const DEFAULT_STEP_SCRIPTS: ReadonlyArray<{ nodeKey: string; file: string; label: string }> = [
  { nodeKey: 'git', file: GIT_STEP_SCRIPT_FILE, label: '拉取代码（默认脚本，可编辑）' },
];

/** 取某个默认节点脚本的正文（用于新建流水线时的初始值） */
export function getDefaultStepScript(nodeKey: string): string {
  const item = DEFAULT_STEP_SCRIPTS.find((s) => s.nodeKey === nodeKey);
  if (!item) throw new Error(`未知的默认节点脚本: ${nodeKey}`);
  return readStepScript(item.file);
}

/**
 * 平台脚本目录（运行期绝对路径）。
 *
 * 供动作脚本定位随 console 分发的平台**工具**（如 `write-version.mjs`）
 * —— 引擎通过 `WS_PLATFORM_SCRIPTS_DIR` 变量注入，脚本只「调用工具」，
 * 业务实现（重启、探活）不在这里，而在 DB action 脚本正文里。
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

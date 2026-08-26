import {
  loadConfig,
  promptConfig,
  promptSearchOnly,
  applyConfigToEnv,
  saveConfig,
  getConfigPath,
} from '../config-store';

/** config 子命令：无配置则引导；已配置则提供【重配全部 / 仅补配搜索】选项 */
export async function runConfig(): Promise<void> {
  const existing = loadConfig();
  if (!existing || Object.keys(existing.models).length === 0) {
    const cfg = await promptConfig();
    applyConfigToEnv(cfg);
    return;
  }

  const readline = require('readline') as typeof import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(
    `当前已配置模型: ${Object.keys(existing.models).join(', ')}\n` +
      `配置目录: ${getConfigPath()}\n` +
      `请选择: [1] 重新配置全部  [2] 仅补配联网搜索  [其他] 退出 > `,
    async (ans) => {
      rl.close();
      const choice = ans.trim();
      if (choice === '1') {
        const cfg = await promptConfig();
        applyConfigToEnv(cfg);
      } else if (choice === '2') {
        await patchSearchOnly();
      }
    },
  );
}

/** 仅补配联网搜索凭据：追加到现有配置并注入 env */
async function patchSearchOnly(): Promise<void> {
  const search = await promptSearchOnly();
  const cfg = loadConfig();
  if (!cfg || !search) {
    if (cfg) applyConfigToEnv(cfg); // 未输入则保持现状
    return;
  }
  cfg.search = { ...(cfg.search ?? {}), ...search };
  saveConfig(cfg);
  applyConfigToEnv(cfg);
}

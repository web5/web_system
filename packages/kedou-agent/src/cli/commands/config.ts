import { loadConfig, promptConfig, applyConfigToEnv, getConfigPath } from '../config-store';

/** config 子命令：无配置则引导，已配置则询问是否重配 */
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
    `是否重新配置？[y/N] `,
    async (ans) => {
      rl.close();
      if (ans.trim().toLowerCase() === 'y' || ans.trim().toLowerCase() === 'yes') {
        const cfg = await promptConfig();
        applyConfigToEnv(cfg);
      }
    },
  );
}

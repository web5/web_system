import { buildHarness } from '../harness';
import { listSearchKeyStatus, getConfigPath, loadConfig } from '../config-store';

export function runModels(): void {
  const harness = buildHarness();
  console.log('\n大模型配置状态:');
  for (const m of harness.clientRegistry.listModels()) {
    const tag = m.available ? '[✓ 已配置]' : '[✗ 未配置]';
    console.log(`  ${tag}  ${m.id}  (${m.displayName})`);
  }

  console.log('\n联网搜索 (web-search):');
  for (const s of listSearchKeyStatus()) {
    const tag = s.available ? '[✓ 已配置]' : '[✗ 未配置]';
    console.log(`  ${tag}  ${s.id}`);
  }

  const cfg = loadConfig();
  console.log(`\n配置目录: ${getConfigPath()}`);
  if (cfg) console.log(`默认模型: ${cfg.defaultModel}`);
  console.log('提示：运行 `kedou-agent config` 重新配置。');
}

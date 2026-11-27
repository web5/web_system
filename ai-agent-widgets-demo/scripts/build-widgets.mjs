// 逐个把 widget 子应用构建成 System.register 产物。
// 每个子应用单独跑一次 Vite build（避免多入口 code-splitting 产生互相依赖的 chunk，
// 简版 SystemJS loader 不需要处理 chunk 间引用），落到 public/mf-widgets/。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const widgets = ['poll', 'chart', 'form'];

for (const name of widgets) {
  process.stdout.write(`\n[mf-widgets] 构建 ${name}.system.js ...\n`);
  const r = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.widgets.config.ts'],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, VITE_WIDGET: name },
    },
  );
  if (r.status !== 0) {
    console.error(`[mf-widgets] ${name} 构建失败 (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
}
process.stdout.write('\n[mf-widgets] 全部 System.register 产物已生成到 public/mf-widgets/\n');

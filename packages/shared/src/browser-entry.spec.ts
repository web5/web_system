import { execFileSync } from 'child_process';
import { resolve } from 'path';

/**
 * 锁住「前端只能从 browser.ts 取本包能力」这条结构约束。
 *
 * 背景（2026-11-06 微前端白屏 P0）：前端 `import { API_TIMEOUT } from '@web-system/shared'`
 * 曾解析到后端 barrel `src/index.ts`，其中 `export { DEFAULT_STORAGE_BASE } from './storage-dir'`
 * 让 `storage-dir.ts` 进了浏览器产物 —— 而它**顶层**就执行
 * `nodePath.join(os.homedir(), 'web_system')`。浏览器里 os/path 是空的
 * `__viteBrowserExternal` 对象，于是模块 execute 期抛
 * `TypeError: (void 0) is not a function`，admin / portal 双双启动即崩、整站白屏。
 *
 * 那次事故的致命点在于：**`vite build` 退出码 0、产物看着正常、运行时 init 期才炸**。
 * 所以这里不复述「导出项对不对」，而是直接让机器去走一遍 browser.ts 的模块图，
 * 断言里面没有 node 内置模块 / process.env / 服务端框架。
 *
 * 校验实现见 `scripts/check-shared-browser-safety.mjs`（同一份逻辑也挂在
 * `node scripts/build-module.mjs <key>` 的构建前后，以及根 `pnpm check:shared-browser`）。
 */
describe('packages/shared 浏览器入口（browser.ts）', () => {
  const script = resolve(__dirname, '../../../scripts/check-shared-browser-safety.mjs');

  it('模块图里不含 node 内置模块 / process.env / 服务端框架', () => {
    // 失败时 execFileSync 会把子进程的报错清单原样抛出来（脚本自己负责可读文案）
    expect(() =>
      execFileSync(process.execPath, [script, '--graph-only'], {
        stdio: 'pipe',
        encoding: 'utf-8',
      }),
    ).not.toThrow();
  });
});

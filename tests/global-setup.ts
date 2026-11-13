/**
 * tests/global-setup.ts — 环境可达性 preflight（FAIL-fast）
 *
 * 为什么存在（03 方案 §2.4 / 现状硬伤⑤）：
 *   没有 preflight 时，localhost 服务没起会表现为「N 条用例各自 30s 超时」，
 *   环境噪声混进测试信号。这里在跑任何用例前对每个 project 依赖的基地址做一次
 *   秒级探测，不可达就直接抛出「环境不可用」横幅并终止，信号归一。
 *
 * 口径：
 *   - 「可达」= 拿到任意 HTTP 响应（含 4xx）；连接拒绝/超时 = 不可达。
 *   - 只探测本次实际要跑的 project（--project 过滤后不 probe 无关服务）。
 *   - 本地与 CI 同一口径：不可达即 FAIL（web 侧不引入小程序线的 REQUIRE_ENV 逃生门，
 *     本地可用 E2E_WEBSERVER=1 让 Playwright 自起静态前端，见 README）。
 */
import type { FullConfig } from '@playwright/test';
import * as net from 'node:net';
import { PROJECT_URLS } from './support/env';

/** 从 process.argv 解析 --project 过滤（支持 --project=x / --project x / 多次） */
function selectedProjects(): string[] {
  const argv = process.argv;
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project' && argv[i + 1]) out.push(argv[i + 1]);
    else if (a.startsWith('--project=')) out.push(a.slice('--project='.length));
  }
  return out;
}

/**
 * TCP 级可达性探测（不用 fetch：fetch/Chromium 有受限端口清单，
 * 如 gateway :6000 会被判 "bad port"/ERR_UNSAFE_PORT，与「服务有没有在听」是两件事。
 * 浏览器侧能不能导航该 URL 由用例自身暴露，preflight 只管「环境在不在」。）
 */
async function probe(url: string, timeoutMs = 3000): Promise<{ ok: boolean; detail: string }> {
  let host: string;
  let port: number;
  try {
    const u = new URL(url);
    host = u.hostname;
    port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  } catch {
    return { ok: false, detail: `URL 解析失败: ${url}` };
  }
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok: boolean, detail: string) => {
      sock.destroy();
      resolve({ ok, detail });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true, `TCP ${host}:${port} 可达`));
    sock.once('timeout', () => done(false, `TCP 连接超时（${timeoutMs}ms）`));
    sock.once('error', (err: NodeJS.ErrnoException) => done(false, err?.code || err?.message || String(err)));
    sock.connect(port, host);
  });
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  const selected = selectedProjects();
  const targets = new Map<string, string>();
  for (const [project, url] of Object.entries(PROJECT_URLS)) {
    if (selected.length > 0 && !selected.includes(project)) continue;
    targets.set(project, url);
  }

  // 同一 URL 只探测一次（portal/admin/mobile-portal/release 共享 BASE_URL）
  const probed = new Map<string, { ok: boolean; detail: string }>();
  const failures: string[] = [];
  for (const [project, url] of targets) {
    if (!probed.has(url)) probed.set(url, await probe(url));
    const r = probed.get(url)!;
    const mark = r.ok ? 'OK ' : 'FAIL';
    // preflight 结果是本脚本的预期产出（产品行为，非调试残留），走 stdout 直写
    process.stdout.write(`[preflight] ${mark} project=${project} url=${url} (${r.detail})\n`);
    if (!r.ok) failures.push(`project=${project} url=${url} (${r.detail})`);
  }

  if (failures.length > 0) {
    throw new Error(
      [
        '',
        '==================== E2E 环境不可用（preflight FAIL-fast） ====================',
        ...failures.map((f) => `  ✗ ${f}`),
        '',
        '排查提示：',
        '  1. 本地全栈：bash scripts/local-up.sh（默认 BASE_URL=https://local.kedouai.com，envoy→gateway :6000，',
        '     前置 MySQL/Redis + envoy；⚠️ 不要把 BASE_URL 指成 http://localhost:6000——6000 是 Chromium',
        '     受限端口（ERR_UNSAFE_PORT），浏览器导航必败，这也是默认走 local.kedouai.com 的原因）',
        '  2. deploy-console：本机常驻 :6200，未起时 console project 必挂',
        '  3. 无后端只想跑前端用例：先 pnpm --filter @web-system/portal build && pnpm --filter @web-system/admin build，',
        '     再 E2E_WEBSERVER=1 BASE_URL=http://127.0.0.1:8899 pnpm test:e2e（Playwright 自起 tests/support/static-server.mjs）',
        '  4. 连 dev 环境：BASE_URL=https://dev.kedouai.com pnpm test:e2e',
        '  5. 确认端口被谁占用：lsof -nP -iTCP:<port> -sTCP:LISTEN（勿 kill 共享服务 6000/6200，先打招呼）',
        '==============================================================================',
        '',
      ].join('\n'),
    );
  }
}

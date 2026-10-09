/**
 * 变量引用存在性检查单测（pipeline-lint L4 的服务端同款实现）。
 *
 * 重点守住两条历史假阳性（CLI 侧踩过，此处防回归）：
 *   A. `${X:-默认值}` 曾被判成未声明（正则漏了 ':' 在 '-' 前）
 *   B. `case ...) TAG="..." ;;` 这种非行首赋值曾被判成未声明
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { undeclaredVars, PLATFORM_VARS } from './script-vars';
import { resolveStageVars } from '../pipeline/pipeline.service';

describe('undeclaredVars', () => {
  it('A. 带非空默认值的引用不算未声明（历史 bug 防回归）', () => {
    expect(undeclaredVars('KEY="${PUBLISH_KEY:-$HOME/.ssh/id_ed25519}"')).toEqual([]);
    expect(undeclaredVars('echo "${PM2_BIN:-pm2}" "${X:=1}" "${Y:?boom}"')).toEqual([]);
  });

  it('A2. 空兜底 ${X:-} 仍算未声明（会静默展开成空串）', () => {
    expect(undeclaredVars('BASE="${CONSOLE_API_PROD:-}"')).toEqual(['CONSOLE_API_PROD']);
  });

  it('B. 非行首赋值（case/if 分支内）视为脚本内声明（历史 bug 防回归）', () => {
    const script = [
      'case "$DEPLOY_ENV" in',
      '  prod) TAG="${COMMIT_ID}" ;;',
      '  *) TAG="dev" ;;',
      'esac',
      'if [ -n "$TAG" ]; then TAG_ENV=prod; else TAG_ENV=dev; fi',
      'echo "$TAG" "$TAG_ENV"',
    ].join('\n');
    expect(undeclaredVars(script)).toEqual([]);
  });

  it('平台注入变量豁免', () => {
    for (const v of ['DEPLOY_ENV', 'COMMIT_ID', 'CONSOLE_API', 'HOME']) {
      expect(undeclaredVars(`echo "$${v}"`)).toEqual([]);
    }
    expect(PLATFORM_VARS.has('CONSOLE_API')).toBe(true);
  });

  it('已登记变量（declared）豁免', () => {
    expect(undeclaredVars('curl "$CONSOLE_TOKEN_PROD"', new Set(['CONSOLE_TOKEN_PROD']))).toEqual([]);
    expect(undeclaredVars('curl "$CONSOLE_TOKEN_PROD"')).toEqual(['CONSOLE_TOKEN_PROD']);
  });

  it('裸引用（无兜底）判为未声明，并去重', () => {
    expect(undeclaredVars('echo "$FOO_BAR" && echo "$FOO_BAR" "$BAZ_QUX"')).toEqual([
      'FOO_BAR',
      'BAZ_QUX',
    ]);
  });

  it('for / read 引入的变量不算未声明', () => {
    expect(undeclaredVars('for ITEM in a b; do echo "$ITEM"; done')).toEqual([]);
    expect(undeclaredVars('read -r ANSWER; echo "$ANSWER"')).toEqual([]);
  });
});

/**
 * 2026-10-09 回归：新增平台注入变量 `RUN_ID`（流水线 run id，脚本透传为锁 owner）后，
 * 漏改门禁白名单 → 保存动作脚本时被拒「引用了未声明变量 RUN_ID」。
 * 这类「加注入变量要同步 N 处」的漂移必须有测试兜住，不能靠人记。
 */
describe('平台注入变量与门禁白名单的一致性', () => {
  it('RUN_ID 属于平台变量（脚本可直接引用，无需登记）', () => {
    expect(PLATFORM_VARS.has('RUN_ID')).toBe(true);
    expect(undeclaredVars('curl -d "{\\"lockOwner\\":\\"${RUN_ID}\\"}"')).toEqual([]);
  });

  it('服务端白名单与 CLI（scripts/pipeline-lint.mjs）逐项一致 —— 改一边忘另一边即红', () => {
    const src = readFileSync(
      resolve(__dirname, '..', '..', '..', '..', 'scripts', 'pipeline-lint.mjs'),
      'utf-8',
    );
    const block = src.match(/const PLATFORM_VARS = new Set\(\[([\s\S]*?)\]\);/);
    expect(block).toBeTruthy();
    const cli = new Set(
      [...(block?.[1] ?? '').matchAll(/'([A-Z_][A-Z0-9_]*)'/g)].map((m) => m[1]),
    );
    // 双向比对：任何一侧新增/删除而未同步都会在这里暴露
    const onlyServer = [...PLATFORM_VARS].filter((v) => !cli.has(v));
    const onlyCli = [...cli].filter((v) => !PLATFORM_VARS.has(v));
    expect({ onlyServer, onlyCli }).toEqual({ onlyServer: [], onlyCli: [] });
  });

  it('resolveStageVars 注入的每个键都必须在白名单里（新增注入变量即强制同步）', () => {
    const v = resolveStageVars({
      env: 'dev',
      moduleKey: 'portal',
      runId: 'run-1',
      releaseWorkspace: '/ws',
      commitId: 'abc1234',
    });
    const missing = Object.keys(v).filter((k) => !PLATFORM_VARS.has(k));
    expect(missing).toEqual([]);
  });
});

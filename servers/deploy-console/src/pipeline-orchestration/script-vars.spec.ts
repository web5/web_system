/**
 * 变量引用存在性检查单测（pipeline-lint L4 的服务端同款实现）。
 *
 * 重点守住两条历史假阳性（CLI 侧踩过，此处防回归）：
 *   A. `${X:-默认值}` 曾被判成未声明（正则漏了 ':' 在 '-' 前）
 *   B. `case ...) TAG="..." ;;` 这种非行首赋值曾被判成未声明
 */
import { undeclaredVars, PLATFORM_VARS } from './script-vars';

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

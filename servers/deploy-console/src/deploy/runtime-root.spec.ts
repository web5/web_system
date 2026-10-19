import { resolveRuntimeRoot } from './runtime-root';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

describe('runtime root resolution', () => {
  const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as any;
  it('uses the canonical web_system default', () => {
    expect(resolveRuntimeRoot(config({}), 'prod')).toBe('/data/web_system');
  });
  it('uses the same explicit environment override for deployment and cleanup', () => {
    expect(resolveRuntimeRoot(config({ WEB_SYSTEM_DIR: '/global/web_system', WEB_SYSTEM_DIR_PROD: '/srv/web_system/' }), 'prod')).toBe('/srv/web_system');
  });
  it.each(['web_system', '/', '/data/web_system_git', "/data/web_system';touch /tmp/unexpected", '/data/web_system\nother'])('rejects an unsafe or retired root %s', root => {
    expect(() => resolveRuntimeRoot(config({ WEB_SYSTEM_DIR: root }), 'prod')).toThrow();
  });

  it('keeps the shell deployment, rollback and migration root guard canonical', () => {
    const library = path.resolve(__dirname, '../../../../scripts/lib/runtime-root.sh');
    expect(execFileSync('bash', ['-c', 'source "$1"; ws_runtime_root "$2"', 'runtime-root', library, '/data/web_system/'], { encoding: 'utf8' }).trim()).toBe('/data/web_system');
    expect(() => execFileSync('bash', ['-c', 'source "$1"; ws_runtime_root "$2"', 'runtime-root', library, '/data/web_system_git'], { stdio: 'pipe' })).toThrow();
  });
});

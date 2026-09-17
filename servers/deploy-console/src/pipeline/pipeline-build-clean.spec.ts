/**
 * P0-2（2026-09-17）：build 节点执行前清空产物目录。
 *
 * 真实事故：后台服务 tsconfig 开 `incremental`，`dist` 被清理后只剩 `tsconfig.tsbuildinfo`
 * → tsc 判定"已是最新"只更新 tsbuildinfo、不产出 JS → 版本目录空壳 → 落地后服务变砖。
 * 守卫（落地前断言）见 deploy-artifact-guard.spec.ts；这里测**源头清理**。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cleanBuildOutputDir } from './pipeline.service';

describe('cleanBuildOutputDir（构建前清理产物目录）', () => {
  let workspace: string;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'build-clean-'));
  });

  it('清掉 tsbuildinfo 与旧产物（这样 tsc 才会全量重编）', () => {
    const out = path.join(workspace, 'servers/svc/dist');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'tsconfig.tsbuildinfo'), '{}');
    fs.writeFileSync(path.join(out, 'main.js'), '// stale');

    expect(cleanBuildOutputDir(out)).toEqual({ cleaned: true });
    expect(fs.existsSync(out)).toBe(false);
  });

  it('目录不存在 → cleaned=false，不报错', () => {
    const r = cleanBuildOutputDir(path.join(workspace, 'servers/svc/dist'));
    expect(r.cleaned).toBe(false);
    expect(r.error).toBeUndefined();
  });

  it('没传目录 → cleaned=false，不报错', () => {
    expect(cleanBuildOutputDir(undefined).cleaned).toBe(false);
    expect(cleanBuildOutputDir('').cleaned).toBe(false);
  });

  it('清理失败 → 返回 error 而不抛错（不阻断构建，落地守卫兜底）', () => {
    // 只读目录：rmSync 会抛 EACCES / EPERM（root 下可能仍成功，故只在失败时断言）
    const out = path.join(workspace, 'servers/svc/dist');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'main.js'), 'x');
    fs.chmodSync(path.dirname(out), 0o500);
    const r = cleanBuildOutputDir(out);
    fs.chmodSync(path.dirname(out), 0o700);
    if (r.cleaned) {
      expect(fs.existsSync(out)).toBe(false);
    } else {
      expect(typeof r.error).toBe('string');
    }
  });

  it('清理后重新构建 → 产物目录里只剩真正的产物（无 tsbuildinfo 残留嫌疑）', () => {
    const out = path.join(workspace, 'servers/svc/dist');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'tsconfig.tsbuildinfo'), '{}');

    cleanBuildOutputDir(out);

    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'main.js'), '// fresh');
    expect(fs.readdirSync(out)).toEqual(['main.js']);
  });
});

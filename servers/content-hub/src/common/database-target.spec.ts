/**
 * content-hub 接入共享守卫的静态断言。
 *
 * 纯函数单测已上提 `packages/shared/src/database-target.spec.ts`（唯一实现），
 * 本文件只保留「app.module.ts 确实接上共享守卫」的回归断言。
 * 断言纯读源码字符串、不 import 运行时符号，因此不依赖 shared/dist 是否已构建。
 * 变异验证：把 app.module.ts 的 database / synchronize 改回老写法，本文件必须红。
 */
import * as fs from 'fs';
import * as path from 'path';

describe('content-hub app.module.ts 接入 @web-system/shared 守卫', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../app.module.ts'), 'utf8');

  it('从共享包引入 resolveDbTarget 并计算 dbTarget', () => {
    expect(source).toContain("from '@web-system/shared'");
    expect(source).toContain('resolveDbTarget(');
    expect(source).toContain('DB_TARGET_ALLOWLIST_ENV');
    expect(source).not.toContain("from './common/database-target'");
  });

  it('mysql / postgres 两分支的 database 与 synchronize 都取自守卫结果', () => {
    expect(source.split('database: dbTarget.database').length - 1).toBe(2);
    expect(source.split('synchronize: dbTarget.synchronize').length - 1).toBe(2);
    expect(source).not.toContain(
      "synchronize: configService.get('NODE_ENV') !== 'production'",
    );
    expect(source).not.toContain("database: configService.get<string>('DB_DATABASE', 'web_system')");
  });
});

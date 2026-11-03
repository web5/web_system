import * as nodePath from 'path';

/**
 * 运行数据根目录解析 — 唯一实现，禁止各服务用 `process.cwd()` 自拼。
 *
 * 背景：`uploads` / `temp-images` 等数据目录曾用 `process.cwd()` 拼接，
 * 进程运行身份（pm2 `pm_cwd`）一变，存量文件就读不到
 * （2026-11-02 ai-service 临时图 404 实证：修正 cwd 后旧图全部失效）。
 *
 * 约定：
 * - **`WEB_SYSTEM_DIR`**：运行根（/data/web_system），与 deploy-console 注入变量
 *   同名同义。部署机通过服务 `.env` 配置；数据目录由「服务目录」归位到「运行根」。
 * - 未配置时回退 `process.cwd()`：本地开发零配置可用，行为与历史一致。
 * - 只在**调用时**读环境变量而非模块加载期缓存：测试可注入，重启即生效。
 *
 * 用法：
 * ```ts
 * dataDir('uploads');               // $WEB_SYSTEM_DIR/uploads 或 $cwd/uploads
 * dataDir('temp-images', name);     // 运行根/temp-images/<name>
 * dataRoot();                       // 仅取根，供 useStaticAssets 等
 * ```
 */
export function dataRoot(env: Record<string, string | undefined> = process.env): string {
  return env.WEB_SYSTEM_DIR || process.cwd();
}

/** 运行数据根下的某个数据目录（如 uploads / temp-images） */
export function dataDir(...segments: string[]): string {
  return nodePath.join(dataRoot(), ...segments);
}

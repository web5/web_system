import { existsSync } from 'fs';
import { join } from 'path';

/**
 * gateway 托管前端静态文件的根目录（P2，2026-09-20）。
 *
 * 默认 = `servers/gateway/dist/public`（与历史行为逐字节一致）；
 * 配环境变量 `STATIC_PUBLIC_ROOT` 可指向任意目录（工作区、独立产物目录…），
 * 用于「产物存放位置可配置」—— 换目录只改配置，不改代码与模板。
 *
 * 单一定义：静态伺服（`static.module.ts`）与 manifest / index.html 读取
 * （`deploy-version/index-html.service.ts`）共用，避免两处漂移。
 *
 * ⚠️ 该常量在 **import 期**求值：`STATIC_PUBLIC_ROOT` 必须由进程 env 注入
 * （ecosystem.config.js 的 env 块 / 根 .env.production），写在
 * `servers/gateway/.env` 里无效（@nestjs/config 加载得太晚）。
 */
export const PUBLIC_ROOT = process.env.STATIC_PUBLIC_ROOT || join(__dirname, '..', '..', 'public');

/**
 * 启动自检：静态根里必须存在 shell 基座 html，否则 fail-fast。
 *
 * 背景（2026-11-04 dev/prod portal 全白屏）：dist 被换成 runtime 版本目录软链后，
 * `__dirname` realpath 漂移让默认 PUBLIC_ROOT 指向一个不存在的目录；
 * `IndexHtmlService.readHtml()` 的 catch 把失败静默吞成
 * `index.html not found for shell`，HTTP 仍是 200 —— 故障被掩盖且极难定位。
 *
 * 与其让服务带着坏根「正常」启动，不如启动时就明确报错：
 * 错误信息直接给出当前 PUBLIC_ROOT 与修复入口（ecosystem env 透传）。
 * 应急可用 `STATIC_PUBLIC_ROOT_STRICT=0` 降级为仅告警。
 */
export function assertPublicRoot(root: string = PUBLIC_ROOT): void {
  const shellHtml = join(root, 'shell', 'index.html');
  if (existsSync(shellHtml)) return;

  const msg =
    `[gateway] STATIC_PUBLIC_ROOT 不可用：未找到 ${shellHtml}。` +
    ` 当前 PUBLIC_ROOT=${root}；请在 ecosystem.config.js 的 gateway env 中透传 ` +
    `STATIC_PUBLIC_ROOT（写 servers/gateway/.env 无效，import 期就已求值）。`;

  if (String(process.env.STATIC_PUBLIC_ROOT_STRICT ?? '1') === '0') {
    // eslint-disable-next-line no-console
    console.error(msg + ' [STRICT=0，仅告警]');
    return;
  }
  throw new Error(msg);
}

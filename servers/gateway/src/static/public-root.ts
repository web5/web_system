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
 */
export const PUBLIC_ROOT = process.env.STATIC_PUBLIC_ROOT || join(__dirname, '..', '..', 'public');

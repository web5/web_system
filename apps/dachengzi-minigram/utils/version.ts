/**
 * 小程序版本号唯一真源（关于页展示用）—— 纯函数层。
 *
 * 需求真源：`30-任务产物/2026-11-26-大橙子10018修复方案/00-方案.md` §1.4
 *
 * 🔴 为什么需要这个文件：1.0.17 的关于页把版本号写死成模板字面量（`about.wxml:6`
 *    的 `v1.0.0`），用户装到 1.0.17 的包却看到 1.0.0。小程序运行期又**拿不到**
 *    `package.json`（`project.config.json` 的 `packOptions.ignore` 已把该文件排除出包），
 *    所以版本号只能来自「编译期常量」或「微信 API」，二者都必须在这里收口。
 *
 * 🔴 三态（微信现实约束，缺一不可）：
 *  - 正式版（release）：`wx.getAccountInfoSync().miniProgram.version` 有真值 → 用它。
 *    好处是「常量忘 bump」也不会把旧号显示给线上用户（真值自愈）；
 *  - 体验版（trial）/ 开发版（develop）/ 开发者工具：该字段返回**空串**（不是 undefined）
 *    → 回退 `APP_VERSION`；
 *  - 老基础库无 `getAccountInfoSync` / 调用抛错 → 回退 `APP_VERSION`。
 *    必须 try/catch：异常若冒到页面会直接让「关于」页白屏，比版本号不准严重得多。
 *
 * 🔴 格式白名单 `/^\d+\.\d+\.\d+$/`：不校验就可能把空串、`' 1.0.18 '`、
 *    甚至 `develop` 之类脏值直接渲染成 `v` 或 `v develop`。放行标准只有「像版本号」。
 *
 * 🔴 `APP_VERSION` 必须与 `package.json.version` 字面相等，两处双保险：
 *    - `tests/version.test.ts` 断言相等（本地 / CI 跑测试即红）；
 *    - `scripts/publish.js` 上传前 `assertVersionConsistent` 硬失败（绕过测试也拦得住）。
 *
 * 边界（对齐 `utils/greeting.ts` 的写法约定）：
 *  - 零 IO：不读 storage、不请求、不打日志；
 *  - 零 UI 接线：不 import 任何 page / wxml，只有关于页把它接进 data；
 *  - 恒返回非空串、绝不外抛 —— 调用方无需再兜底。
 */

/** 编译期版本常量。改这里必须同步 `package.json.version`（单测与上传脚本都会卡）。 */
export const APP_VERSION = '1.0.18';

/**
 * 取展示用版本号（不带 `v` 前缀，模板自行拼 `v`）。
 *
 * @returns 合法版本号字符串，恒非空、绝不抛异常。
 */
export function resolveAppVersion(): string {
  try {
    // 老基础库可能没有 getAccountInfoSync；类型上该字段非可选，运行期则可能缺失
    const info =
      typeof wx !== 'undefined' && typeof wx.getAccountInfoSync === 'function'
        ? wx.getAccountInfoSync()
        : undefined;
    const v = info && info.miniProgram ? info.miniProgram.version : undefined;
    // 体验版 / 开发版是空串；脏值一并挡掉，只有形如 x.y.z 才认
    if (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v)) return v;
  } catch {
    // 无该 API / 调用被拒 / 取值抛错 → 一律回退常量，绝不外抛（否则关于页白屏）
  }
  return APP_VERSION;
}

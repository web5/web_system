/**
 * automator 加载与 checkVersion patch（内部模块，不从 index 导出）
 *
 * 隔离两个「必踩坑」（迁移自 dachengzi tests/e2e/helper.js 头注）：
 * 1. automator 0.12.1 的 MiniProgram.checkVersion() 读 Tool.getInfo().SDKVersion，
 *    但开发者工具 36.x 的 automation 协议已移除该字段（返回 undefined），
 *    导致 licia/cmpVersion 里 .split 报错、launch 直接失败 —— 必须在 launch 前 patch 掉。
 * 2. pnpm monorepo：automator 装在调用方 app 的 devDependencies（实为根 node_modules），
 *    必须用 createRequire 从「调用方位置」解析，保证 patch 打在 launch 实际使用的
 *    同一个模块实例原型上（包内若自装一份，patch 会打在错误的实例上）。
 *
 * ⚠️ 升级 miniprogram-automator 前先看 README「已知限制」第 ③ 条。
 */

const { createRequire } = require('module');
const path = require('path');

/** 幂等标志：同一进程内 patch 只包一次原型（重复 require 有缓存，这里是双保险） */
let patched = false;

/**
 * 从调用方目录构造 require（createRequire 是 node >=12 稳定 API，engines 锁 >=18）。
 * 独立成函数便于单测验证解析路径推导。
 */
function buildCallerRequire(callerDir) {
  return createRequire(path.join(callerDir, 'package.json'));
}

/**
 * 从调用方位置解析 miniprogram-automator 并 patch checkVersion（幂等）。
 * @param {string} callerDir 调用方 app 根目录（runner 进程的 config 所在目录）
 * @returns automator 模块（调用方 node_modules 解析到的实例）
 */
function loadAutomator(callerDir) {
  const req = buildCallerRequire(callerDir);
  // 先 patch 子路径里的 MiniProgram 类（launch 实际用的就是它），再取主入口。
  // automator 0.12.1 无 exports 字段，子路径 require 合法（已实测）。
  const MP = req('miniprogram-automator/out/MiniProgram').default;
  if (!patched) {
    // eslint-disable-next-line
    MP.prototype.checkVersion = async function () {};
    patched = true;
  }
  return req('miniprogram-automator');
}

module.exports = { loadAutomator, buildCallerRequire };

/**
 * @web-system/mp-e2e 导出面聚合（稳定面，语义化版本内不破坏）
 *
 * 调用方只允许 require('@web-system/mp-e2e')（本入口），禁止深路径 require src/*。
 * 本包永不反向依赖 apps/* 任何文件。
 *
 * 不导出（内部实现细节，用例不许碰）：loadAutomator、checkVersion patch、
 * nav() 底层封装、CLI 默认路径常量、normalizePath。
 *
 * 说明（R5）：tap/dom 断言走 ctx.mp.currentPage() 的 page 对象、sourceShell 断言
 * 走裸 node execSync——这两类能力不封装、允许直达，不是缺 API。
 */

const { launch, close } = require('./session');
const { pollPath, switchTab, navigateTo, reLaunch, navigateBack } = require('./navigate');
const { currentPath, stackPaths, pageData, waitForData, tabBarSelected } = require('./page');
const { getStorage, setStorage, removeStorage } = require('./storage');
const { assertEqual, assertOk } = require('./assert');
const { assertKeysInSource } = require('./keys-guard');
const { readRegisteredPages, assertPagesRegistered } = require('./pages-guard');
const { run, blocked, summary, runSuite } = require('./runner');

module.exports = {
  // 会话
  launch,
  close,
  // 导航
  pollPath,
  switchTab,
  navigateTo,
  reLaunch,
  navigateBack,
  // 页面读取
  currentPath,
  stackPaths,
  pageData,
  waitForData,
  tabBarSelected,
  // storage
  getStorage,
  setStorage,
  removeStorage,
  // 断言
  assertEqual,
  assertOk,
  // 守卫
  assertKeysInSource,
  readRegisteredPages,
  assertPagesRegistered,
  // 步骤 harness 与 runner
  run,
  blocked,
  summary,
  runSuite,
};

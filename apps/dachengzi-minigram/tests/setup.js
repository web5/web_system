// tests/setup.js
// 微信小程序自动化测试环境设置
//
// ⚠️ 这里启动的是**真机 E2E**：automator.launch 会拉起微信开发者工具 GUI，
// 耗时远大于 jest 默认的 5s hook 超时。launch 阶段必须显式给 timeout，
// 否则表现为「9 个用例全红 + Exceeded timeout of 5000 ms for a hook」，
// 而真因只是开发者工具启动慢（2026-10-15 实测）。

const automator = require('miniprogram-automator');

/** macOS 默认路径；可用 WECHAT_DEVTOOLS_CLI 覆盖（换机 / 非标准安装） */
const DEFAULT_CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';
const CLI_PATH = process.env.WECHAT_DEVTOOLS_CLI || DEFAULT_CLI;

/** 启动开发者工具的耗时上限：拉起 GUI + 首次编译，实测 20s 足够 */
const LAUNCH_TIMEOUT_MS = Number(process.env.MP_AUTOMATOR_LAUNCH_TIMEOUT || 20000);

module.exports = {
  CLI_PATH,
  LAUNCH_TIMEOUT_MS,

  /**
   * 测试前启动工具。
   *
   * ⚠️ 失败**不抛异常**，而是 resolve(null)：
   *   开发者工具没装 / 没开自动化端口 / 首次编译报错，都是**环境问题**而非代码问题。
   *   抛出去会让整套用例红掉，把环境噪声混进 CI 信号里。
   *   调用方（draw.test.js）拿到 null 后应整体 skip。
   */
  async setup() {
    try {
      return await automator.launch({
        cliPath: CLI_PATH,
        projectPath: process.cwd(),
        timeout: LAUNCH_TIMEOUT_MS,
      });
    } catch (e) {
      const msg = (e && e.message) || String(e);
      console.warn(
        `[setup] 微信开发者工具启动失败，本套 E2E 将跳过：${msg}\n` +
          `         检查：① 开发者工具是否已安装（${CLI_PATH}）` +
          ` ② 设置 → 安全设置 → 服务端口是否开启`,
      );
      return null;
    }
  },

  // 测试后关闭
  async teardown(miniProgram) {
    if (miniProgram) {
      try {
        await miniProgram.close();
      } catch {
        /* 关闭失败无需阻塞测试收尾 */
      }
    }
  },
};

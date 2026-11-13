/**
 * 会话管理：launch / close
 * 泛化自 dachengzi helper.js L37–49 与 kedou tests/setup.js L30–46。
 */

const { loadAutomator } = require('./automator');

/** macOS 默认路径；可用环境变量 WECHAT_DEVTOOLS_CLI 覆盖（换机 / 非标准安装） */
const DEFAULT_CLI_PATH = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli';

/** 启动开发者工具的耗时上限：拉起 GUI + 首次编译，实测 20s 足够；可用 MP_AUTOMATOR_LAUNCH_TIMEOUT 覆盖 */
const DEFAULT_LAUNCH_TIMEOUT_MS = 20000;

/**
 * 字段优先级：环境变量 > e2e.config.js > 包内默认值（仅 cliPath / launchTimeoutMs 支持环境变量覆盖）。
 */
function resolveLaunchConfig(cfg) {
  return {
    cliPath: process.env.WECHAT_DEVTOOLS_CLI || cfg.cliPath || DEFAULT_CLI_PATH,
    projectPath: cfg.projectPath,
    timeout: Number(process.env.MP_AUTOMATOR_LAUNCH_TIMEOUT || cfg.launchTimeoutMs || DEFAULT_LAUNCH_TIMEOUT_MS),
  };
}

/**
 * 启动小程序（每次 launch 都会起一个新的自动化会话；项目 storage 在 devtools 内持久化）。
 *
 * ⚠️ 失败**不抛异常**，返回 null：
 *   开发者工具没装 / 没开服务端口 / 首次编译报错，都是**环境问题**而非代码问题。
 *   抛出去会让整套用例红掉，把环境噪声混进测试信号里。
 *   runner 拿到 null 后整体标 SKIP（exit code 见 README 第④章）。
 *
 * @param {{ callerDir: string, projectPath: string, cliPath?: string, launchTimeoutMs?: number }} cfg
 * @returns {Promise<object|null>} MiniProgram 实例，或环境不可用时 null
 */
async function launch(cfg) {
  const c = resolveLaunchConfig(cfg);
  try {
    const automator = loadAutomator(cfg.callerDir);
    return await automator.launch({
      cliPath: c.cliPath,
      projectPath: c.projectPath,
      timeout: c.timeout,
    });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.warn(
      `[mp-e2e] 微信开发者工具启动失败，本套 E2E 将跳过：${msg}\n` +
        `         检查：① 开发者工具是否已安装（${c.cliPath}）` +
        ` ② 设置 → 安全设置 → 服务端口是否开启`,
    );
    return null;
  }
}

/** 关闭小程序会话（杀自动化进程；close 可能因已断连抛错，吞错语义保留） */
async function close(mp) {
  if (!mp) return;
  try {
    await mp.close();
  } catch (e) {
    /* close 可能因已断连抛错，忽略 */
  }
}

module.exports = { launch, close, resolveLaunchConfig, DEFAULT_CLI_PATH, DEFAULT_LAUNCH_TIMEOUT_MS };

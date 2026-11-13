/**
 * 大橙子助理 · mp-e2e 调用方配置契约（与 @web-system/mp-e2e 之间的唯一配置契约）
 *
 * 字段优先级：环境变量 > 本文件 > 包内默认值
 * （仅 cliPath / launchTimeoutMs 支持环境变量覆盖：WECHAT_DEVTOOLS_CLI / MP_AUTOMATOR_LAUNCH_TIMEOUT）
 */
module.exports = {
  // —— 必填 ——
  entryPath: 'pages/home/index/index', // 启动落点（= app.json pages[0]）
  storageKeys: {
    // 逐 key 注释真源位置（keys-guard 会对每个值在产品源码做字面量扫描对账）：
    history: 'kd_tr_history', // 真源: utils/translate-keys.ts TRANSLATE_HISTORY_KEY
    params: 'kd_translate_params', // 真源: utils/translate-keys.ts TRANSLATE_PARAMS_KEY
    settings: 'kd_tr_settings', // 真源: utils/translate-keys.ts TRANSLATE_SETTINGS_KEY
    radius: 'appearance_radius', // 真源: utils/appearance.ts STORAGE_KEY
    token: 'access_token', // 真源: utils/request.ts TOKEN_KEY（模块私有常量，未 export）
    refreshToken: 'refresh_token', // 真源: utils/request.ts REFRESH_TOKEN_KEY（模块私有常量）
    loggedOut: 'account_logged_out', // 真源: utils/request.ts LOGGED_OUT_KEY（模块私有常量）
    apiBase: 'api_base', // 真源: utils/request.ts 行内字面量（getStorageSync('api_base')）
    nceMode: 'nce-mode', // 真源: pages/nce/detail/detail.ts 行内字面量（get/setStorageSync('nce-mode')）
    nceFont: 'nce-font', // 真源: pages/nce/detail/detail.ts 行内字面量（get/setStorageSync('nce-font')）
  },

  // —— 可选（有默认） ——
  // projectPath: __dirname,       // 默认 = 本 config 所在目录（app 根）
  // cliPath: '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
  // launchTimeoutMs: 20000,
  // casesDir: 'tests/e2e/cases',
};

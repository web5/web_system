/**
 * 流水线脚本「变量引用存在性」检查（对应 pipeline-lint 的 L4 规则）。
 *
 * 判据：脚本里引用了既非平台注入、又非脚本内自赋值、也未在
 * `deploy_pipeline_vars` / 配置中心登记的变量 → 运行时会静默展开成空串，
 * 是「流水线看起来跑成功、实际没生效」的典型病因（如 `${CONSOLE_API_PROD:-}`）。
 *
 * ⚠️ 同一判据有两处实现，必须保持行为一致，改一边要同步另一边：
 *   1. 本文件 —— 服务端保存时门禁（saveTasks）
 *   2. scripts/pipeline-lint.mjs 的 undeclaredVars() —— CLI 全量体检
 */
/**
 * 平台注入变量 —— 权威来源 `pipeline.service.ts` 的 `resolveStageVars()`
 * （脚本可直接引用，无需在流水线变量表声明；勿凭猜测增删）。
 */
export const PLATFORM_VARS = new Set([
  'DEPLOY_ENV', 'MODULE_KEY', 'MODULE_TYPE', 'MODULE_DIR', 'BRANCH', 'COMMIT_ID',
  'RELEASE_DIR', 'STAGE', 'PM2_NAME', 'PORT', 'PORT_SOURCE', 'PM2_SCRIPT', 'PM2_CWD',
  'PUBLIC_PATH', 'ENTRY_FILE', 'BUILD_OUTPUT_DIR', 'ARTIFACT_DIR', 'ARTIFACTS_DIR',
  'DEPLOY_ROOT', 'DEPLOY_TARGET', 'GATEWAY_URL', 'GATEWAY_TTL_SEC', 'KEEP_VERSIONS',
  'PROTECTED_VERSIONS', 'WS_SAFE_DELETE', 'CONSOLE_API', 'CONSOLE_TOKEN',
  // shell 内建与脚本内临时量
  'HOME', 'PATH', 'USER', 'PWD', 'SHELL', 'SSH', 'SCP', 'TS',
  'VERSION_TAG', 'VERSION', 'VER', 'BUILD_ENV',
]);

/**
 * 返回脚本中未声明的变量名（已去重、按出现顺序）。
 * @param declared 已声明变量集合（流水线变量 + 配置中心键）
 */
export function undeclaredVars(script: string, declared?: Set<string>): string[] {
  // 脚本内声明的：NAME=... / local NAME=... / for NAME in / read NAME
  const local = new Set<string>();
  // ⚠️ 旧正则用 `^\s*NAME=` 锚定行首，漏掉了「赋值不在行首」的写法，例如
  //    `case ...) TAG="${COMMIT_ID##*/}" ;;` 与 `if ...; then TAG_ENV=...; else ...; fi`
  //    → TAG / TAG_ENV 被误报未声明。改为按「前一个 token 是分隔符」判定。
  for (const m of script.matchAll(
    /(?:^|[;&|(){}\s])\s*(?:local\s+|export\s+|readonly\s+)?([A-Z_][A-Z0-9_]*)\s*=(?!=)/gm,
  )) {
    local.add(m[1]);
  }
  for (const m of script.matchAll(/\bfor\s+([A-Z_][A-Z0-9_]*)\s+in\b/g)) local.add(m[1]);
  for (const m of script.matchAll(/\bread\s+(?:-r\s+)?([A-Z_][A-Z0-9_]*)/g)) local.add(m[1]);

  // 带「非空默认值」的引用（`${X:-值}` / `${X:=值}` / `${X:?值}`）脚本已自带兜底，不算未声明。
  // ⚠️ 旧正则写成 `(?:-([^}]*)|:[=?][^}]*)`，匹配不到 `${X:-值}`（':' 在 '-' 前），
  //    导致 130+ 条假阳性。现统一识别 `:-` `:=` `:?` `:+` `-` `=` `?` `+` 并判空：
  //    默认值为空（`${X:-}`）等于静默展开成空串，仍视为引用并参与未声明检查。
  const stripped = script.replace(
    /\$\{([A-Z_][A-Z0-9_]*)\s*(?::-|:=|:?|\+|-|=|\?)([^}]*)\}/g,
    (m, _name, def) => (def.trim() === '' ? m : ''),
  );

  const used = new Set<string>();
  for (const m of stripped.matchAll(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g)) used.add(m[1]);

  const miss: string[] = [];
  for (const v of used) {
    if (PLATFORM_VARS.has(v)) continue;
    if (local.has(v)) continue;
    if (declared?.has(v)) continue;
    miss.push(v);
  }
  return miss;
}

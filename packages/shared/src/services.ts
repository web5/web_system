/**
 * 后端服务地址默认值 — 唯一真相源
 *
 * 背景：`AUTH_SERVICE_URL` 等地址的默认值此前在各服务里各写一份（共 7 处），
 * 属于项目禁止的「跨端配置拷贝」。后果是本机 auth-service 实际跑在 6101
 * （6001 被本机其他项目占用，见根 `ecosystem.config.cjs`），而代码默认值写的是
 * 6001 —— 一旦 `.env` 缺配就整站 401（2026-09-11 dev 事故同源）。
 *
 * 收口后：改端口只需改这一个文件。
 *
 * **端口口径（务必看清）**：
 * - 本机 / 本地发布目录：`auth = 6101`（6001 被占用，故错开）
 * - dev / prod 机器：`auth = 6001`，且**必须由 `.env` 显式指定** —— 本默认值面向本地开发，
 *   生产环境依赖 fail-fast 兜底（缺关键地址直接退出，不允许静默走默认值）。
 *
 * 其余端口本机与 dev/prod 一致，见根 `ecosystem.config.cjs`。
 */
export const SERVICE_URL_DEFAULTS = {
  /** 认证服务 */
  auth: 'http://localhost:6101',
  /** 用户服务 */
  user: 'http://localhost:6002',
  /** AI 服务（对话 / 生图 / TTS） */
  ai: 'http://localhost:6003',
  /** AI Agent 运行时 */
  aiAgent: 'http://localhost:6010',
  /** 系统服务（字典 / 日志 / 设置） */
  system: 'http://localhost:6004',
  /** 待办服务 */
  todo: 'http://localhost:6005',
  /** 上传服务 */
  upload: 'http://localhost:6008',
  /** MCP 网关 */
  mcpGateway: 'http://localhost:6006',
  /** 内容中枢 */
  contentHub: 'http://localhost:6007',
  /** 知识库 / RAG */
  knowledge: 'http://localhost:6011',
  /** 发布控制台 */
  deployConsole: 'http://localhost:6200',
} as const;

/**
 * 生产环境必须显式配置的关键服务地址（缺失即 fail-fast，不落默认值）。
 *
 * 只列「默认值在不同环境口径不一致」的那些 —— 正是它们历史上引发过事故。
 * 其余端口本机与 dev/prod 一致，静默走默认值不会连错机器。
 */
export const REQUIRED_SERVICE_URLS_IN_PROD: readonly string[] = ['AUTH_SERVICE_URL'] as const;

/**
 * 生产环境「必需服务地址」的漏配清单（空数组 = 通过）。
 *
 * 只对 `NODE_ENV=production` 生效：本地 / 本地发布目录的默认值可用（auth=6101），
 * 而 dev/prod 的口径不同（auth=6001）——**静默走默认值会连错机器**，故生产必须显式配。
 *
 * 纯函数：不读全局、不退出；日志与 `process.exit(1)` 由调用方（各服务 bootstrap）负责，
 * 这样三 OS / 各服务都好测，也不会让 shared 变成有副作用的模块。
 *
 * @param get     读配置的函数（各服务传 `cfg.get` 或 `process.env` 读取器）
 * @param nodeEnv 当前 NODE_ENV（默认取 process.env，便于单测注入）
 */
export function missingRequiredServiceUrls(
  get: (key: string) => string | undefined,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): string[] {
  if (nodeEnv !== 'production') return [];
  return REQUIRED_SERVICE_URLS_IN_PROD.filter((key) => !String(get(key) ?? '').trim());
}

/** 缺关键服务地址时的统一文案（措辞不漂移，且直接给出修复动作） */
export function serviceUrlFailFastHint(missing: readonly string[]): string {
  return (
    `生产环境缺少必需的服务地址：${missing.join(' / ')} —— ` +
    '这些地址在 dev/prod 与本地口径不同（如 AUTH_SERVICE_URL：dev/prod=6001、本机=6101），' +
    '不能静默走默认值（会连错机器）。请在 .env 显式设置后重启。'
  );
}

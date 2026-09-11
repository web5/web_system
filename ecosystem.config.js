/**
 * PM2 部署配置
 *
 * 使用方式：
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *
 * 重要：所有敏感信息（DB_PASSWORD、JWT_SECRET 等）必须通过 .env.production 设置！
 * 请勿修改此文件中的空字符串默认值，它们会在缺少环境变量时导致启动失败。
 */
/** 运行根目录（发布目录）：通过 WEB_SYSTEM_DIR 注入，默认取当前工作目录 */
const WEB_SYSTEM_DIR = process.env.WEB_SYSTEM_DIR || process.cwd();
/** 尝试加载 .env.production，失败则从 process.env 读取 */
try { require('dotenv').config({ path: process.env.ENV_FILE || `${WEB_SYSTEM_DIR}/.env.production` }); } catch (_) {}

const DB_TYPE = process.env.DB_TYPE || 'mysql';
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USERNAME = process.env.DB_USERNAME || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_DATABASE = process.env.DB_DATABASE || 'web_system';
/** knowledge-service 独立库（RAG：集合/文档/分块），与主库同实例不同库名 */
const KNOWLEDGE_DB_DATABASE = process.env.DB_DATABASE_KNOWLEDGE || 'web_system_knowledge';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
/**
 * 服务间调用：auth-service 地址（各服务 AuthGuard 转发 /auth/verify 用）。
 * dev/prod 约定 6001；本地若该端口被占用，请在对应服务 .env 里显式覆盖（例如 6101）。
 * ⚠️ 不要写成 `process.env.X || ''`：空串会被 ConfigService 当成「已配置」，
 *    导致 fetch('') 失败并被误报成 401「认证服务不可用」（2026-09-11 dev 事故）。
 */
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:6001';
/**
 * 服务间调用：system-service 地址（字典/系统配置等内部接口用）。
 * dev/prod 约定 6004；若某环境 system-service 端口不同，请用 SYSTEM_SERVICE_URL 显式覆盖。
 * ⚠️ 历史坑：多个服务的 pm2 环境里残留过 `http://127.0.0.1:3004`（旧端口），
 *    表现为「服务调 system-service 一律失败 / 字典拉取 401 或 fetch failed」。
 *    排查时务必先看 `pm2 env <id>` 的这项，而不是只看 .env（pm2 env 优先于 dotenv）。
 */
const SYSTEM_SERVICE_URL = process.env.SYSTEM_SERVICE_URL || 'http://127.0.0.1:6004';
const JWT_SECRET = process.env.JWT_SECRET || '';
const MINI_PROGRAM_APP_ID = process.env.MINI_PROGRAM_APP_ID || '';
const MINI_PROGRAM_SECRET = process.env.MINI_PROGRAM_SECRET || '';
const OFFICIAL_ACCOUNT_APP_ID = process.env.OFFICIAL_ACCOUNT_APP_ID || '';
const OFFICIAL_ACCOUNT_SECRET = process.env.OFFICIAL_ACCOUNT_SECRET || '';
const WECHAT_OAUTH_REDIRECT_URI = process.env.WECHAT_OAUTH_REDIRECT_URI || '';

// 启动前校验 JWT_SECRET 非空
if (!JWT_SECRET) {
  console.error('错误：未设置 JWT_SECRET！请在 .env.production 中配置安全的密钥。');
  process.exit(1);
}

const baseDbConfig = {
  DB_TYPE,
  DB_HOST,
  DB_PORT,
  DB_USERNAME,
  DB_PASSWORD,
  DB_DATABASE,
  REDIS_URL,
};

const logBase = process.env.LOG_BASE || `${WEB_SYSTEM_DIR}/logs`;

const commonConfig = {
  instances: 1,
  exec_mode: 'fork',
  cwd: WEB_SYSTEM_DIR,
  time: true,
  merge_logs: true,
  autorestart: true,
  watch: false,
  max_memory_restart: '500M',
  max_restarts: 10,      // 防止无限重启循环
  min_uptime: '10s',      // 10s 内频繁重启则触发 max_restarts
};

module.exports = {
  apps: [
    {
      ...commonConfig,
      name: 'gateway',
      script: './servers/gateway/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6000,
        HOST: '0.0.0.0',
        AUTH_SERVICE_URL,
        USER_SERVICE_URL: 'http://127.0.0.1:6002',
        AI_SERVICE_URL: 'http://127.0.0.1:6003',
        SYSTEM_SERVICE_URL,
        TODO_SERVICE_URL: 'http://127.0.0.1:6005',
        MCP_GATEWAY_URL: 'http://127.0.0.1:6006',
        CONTENT_HUB_SERVICE_URL: 'http://127.0.0.1:6007',
        // 服务间鉴权（mcp-gateway → gateway 调 /api/finnews 时必须带此 Bearer）
        FINNEWS_SERVICE_KEY: process.env.FINNEWS_SERVICE_KEY || '',
        PUBLIC_URL: process.env.PUBLIC_URL || 'http://localhost:6000',
        CORS_ORIGINS: process.env.CORS_ORIGINS || 'https://portal.kedouai.com,https://admin.kedouai.com',
        JWT_SECRET,
      },
      error_file: `${logBase}/gateway-error.log`,
      out_file: `${logBase}/gateway-out.log`,
      log_file: `${logBase}/gateway-combined.log`,
    },
    {
      ...commonConfig,
      name: 'auth-service',
      script: './servers/auth-service/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6001,
        ...baseDbConfig,
        JWT_SECRET,
        JWT_EXPIRES_IN: '7d',
        MINI_PROGRAM_APP_ID,
        MINI_PROGRAM_SECRET,
        OFFICIAL_ACCOUNT_APP_ID,
        OFFICIAL_ACCOUNT_SECRET,
        WECHAT_OAUTH_REDIRECT_URI,
      },
      error_file: `${logBase}/auth-error.log`,
      out_file: `${logBase}/auth-out.log`,
      log_file: `${logBase}/auth-combined.log`,
    },
    {
      ...commonConfig,
      name: 'user-service',
      script: './servers/user-service/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6002,
        ...baseDbConfig,
        AUTH_SERVICE_URL,
        SYSTEM_SERVICE_URL,
      },
      error_file: `${logBase}/user-error.log`,
      out_file: `${logBase}/user-out.log`,
      log_file: `${logBase}/user-combined.log`,
    },
    {
      ...commonConfig,
      name: 'ai-service',
      script: './servers/ai-service/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6003,
        ...baseDbConfig,
        AUTH_SERVICE_URL,
        SYSTEM_SERVICE_URL,
        IMAGE_GEN_API_URL: process.env.IMAGE_GEN_API_URL || 'https://tokenhub.tencentmaas.com',
        IMAGE_GEN_API_KEY: process.env.IMAGE_GEN_API_KEY,
        IMAGE_GEN_MODEL: process.env.IMAGE_GEN_MODEL || 'stable-diffusion-xl',
        BIANBIAN_PUBLIC_BASE_URL: process.env.BIANBIAN_PUBLIC_BASE_URL || process.env.PUBLIC_URL?.replace('http://', 'https://') || 'https://dev.kedouai.com',
      },
      error_file: `${logBase}/ai-error.log`,
      out_file: `${logBase}/ai-out.log`,
      log_file: `${logBase}/ai-combined.log`,
    },
    {
      ...commonConfig,
      name: 'system-service',
      script: './servers/system-service/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6004,
        ...baseDbConfig,
        AUTH_SERVICE_URL,
      },
      error_file: `${logBase}/system-error.log`,
      out_file: `${logBase}/system-out.log`,
      log_file: `${logBase}/system-combined.log`,
    },
    {
      ...commonConfig,
      name: 'todo-service',
      script: './servers/todo-service/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6005,
        ...baseDbConfig,
        JWT_SECRET,
        AUTH_SERVICE_URL,
        SYSTEM_SERVICE_URL,
      },
      error_file: `${logBase}/todo-error.log`,
      out_file: `${logBase}/todo-out.log`,
      log_file: `${logBase}/todo-combined.log`,
    },
    {
      ...commonConfig,
      name: 'upload-service',
      script: './servers/upload-service/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6008,
        ...baseDbConfig,
        SYSTEM_SERVICE_URL,
      },
      error_file: `${logBase}/upload-error.log`,
      out_file: `${logBase}/upload-out.log`,
      log_file: `${logBase}/upload-combined.log`,
    },
    {
      ...commonConfig,
      name: 'mcp-gateway',
      script: './servers/mcp-gateway/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6006,
        ...baseDbConfig,
        SYSTEM_SERVICE_URL,
        // 财经资讯微服务（content-hub 内模块）：默认同机直连 :6007（Node fetch 对 gateway 代理端口有 bad port 问题）
        // 如需经 gateway 代理，可用环境变量覆盖 FINNEWS_SERVICE_URL=http://127.0.0.1:6000/api/finnews + AUTH_TYPE=bearer
        FINNEWS_SERVICE_URL: process.env.FINNEWS_SERVICE_URL || 'http://127.0.0.1:6007',
        FINNEWS_SERVICE_AUTH_TYPE: process.env.FINNEWS_SERVICE_AUTH_TYPE || '',
        FINNEWS_SERVICE_AUTH_CONFIG: process.env.FINNEWS_SERVICE_AUTH_CONFIG || '',
        // 内容中枢（content-hub，含公众号发布接口）：与财经同机直连
        CONTENT_HUB_SERVICE_URL: process.env.CONTENT_HUB_SERVICE_URL || 'http://127.0.0.1:6007',
        CONTENT_HUB_SERVICE_AUTH_TYPE: process.env.CONTENT_HUB_SERVICE_AUTH_TYPE || '',
        CONTENT_HUB_SERVICE_AUTH_CONFIG: process.env.CONTENT_HUB_SERVICE_AUTH_CONFIG || '',
        // 兼容遗留共享密钥（内部/WorkBuddy 集成）；对外公网改为每用户 API Key
        MCP_CLIENT_KEY: process.env.MCP_CLIENT_KEY || '',
        // 运营后台密钥：保护 /api/keys 的列表/吊销接口（X-Admin-Key）
        MCP_ADMIN_KEY: process.env.MCP_ADMIN_KEY || '',
        // 申请验证码邮件（SMTP）；留空则申请接口返回 503
        SMTP_HOST: process.env.SMTP_HOST || '',
        SMTP_PORT: process.env.SMTP_PORT || 465,
        SMTP_USER: process.env.SMTP_USER || '',
        SMTP_PASS: process.env.SMTP_PASS || '',
        SMTP_FROM: process.env.SMTP_FROM || '',
      },
      error_file: `${logBase}/mcp-gateway-error.log`,
      out_file: `${logBase}/mcp-gateway-out.log`,
      log_file: `${logBase}/mcp-gateway-combined.log`,
    },
    {
      ...commonConfig,
      name: 'content-hub',
      script: './servers/content-hub/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6007,
        ...baseDbConfig,
        SYSTEM_SERVICE_URL,
        LLM_API_KEY: process.env.IMAGE_GEN_API_KEY || '',
        LLM_BASE_URL: 'https://tokenhub.tencentmaas.com/v1',
        LLM_MODEL: 'hy3',
        // 微信公众号发布凭据：优先显式 WECHAT_MP_APP_ID/SECRET（dev/prod 公众号不同），
        // 未显式配置时回退登录 OAuth 的 OFFICIAL_ACCOUNT_*
        WECHAT_MP_APP_ID: process.env.WECHAT_MP_APP_ID || OFFICIAL_ACCOUNT_APP_ID,
        WECHAT_MP_APP_SECRET: process.env.WECHAT_MP_APP_SECRET || OFFICIAL_ACCOUNT_SECRET,
      },
      error_file: `${logBase}/content-hub-error.log`,
      out_file: `${logBase}/content-hub-out.log`,
      log_file: `${logBase}/content-hub-combined.log`,
    },
    {
      ...commonConfig,
      name: 'knowledge-service',
      script: './servers/knowledge-service/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6011,
        ...baseDbConfig,
        DB_DATABASE: KNOWLEDGE_DB_DATABASE,
        AUTH_SERVICE_URL,
        SYSTEM_SERVICE_URL,
        INTERNAL_API_KEY: process.env.KNOWLEDGE_INTERNAL_API_KEY || process.env.INTERNAL_API_KEY || '',
        TOKENHUB_BASE_URL: process.env.TOKENHUB_BASE_URL || 'https://tokenhub.tencentmaas.com/v1',
        TOKENHUB_API_KEY: process.env.TOKENHUB_API_KEY || process.env.HY3_API_KEY || process.env.LLM_API_KEY || '',
        EMBEDDING_MODEL: process.env.EMBEDDING_MODEL || 'bge-m3',
        EVAL_LLM_MODEL: process.env.EVAL_LLM_MODEL || 'deepseek-v4-flash',
      },
      error_file: `${logBase}/knowledge-service-error.log`,
      out_file: `${logBase}/knowledge-service-out.log`,
      log_file: `${logBase}/knowledge-service-combined.log`,
    },
    /**
     * ai-agent / deploy-console：长期**未登记**（靠手工 pm2 start）→ 全量重启会漏管，
     * 变成「pm2 列表里看不到、端口却占着」的孤儿进程（2026-09-11 在 dev 上亲历：
     * 这两个不在配置里，别的服务都能 delete+start，只能对它们用 restart 保留 env）。
     *
     * 只登记 `PORT`：两者的其余配置（DB / 密钥 / 发布路径 / 对接的服务器等）都在各自
     * `servers/<svc>/.env` 里，由服务自身 ConfigModule 读取。**刻意不注入 JWT_SECRET**：
     * ai-agent 原本没有该变量、deploy-console 用的是自己的值，注入会改变验签行为。
     */
    {
      ...commonConfig,
      name: 'ai-agent',
      script: './servers/ai-agent/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6010,
      },
      error_file: `${logBase}/ai-agent-error.log`,
      out_file: `${logBase}/ai-agent-out.log`,
      log_file: `${logBase}/ai-agent-combined.log`,
    },
    {
      ...commonConfig,
      name: 'deploy-console',
      script: './servers/deploy-console/dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 6200,
      },
      error_file: `${logBase}/deploy-console-error.log`,
      out_file: `${logBase}/deploy-console-out.log`,
      log_file: `${logBase}/deploy-console-combined.log`,
    },
  ],
};

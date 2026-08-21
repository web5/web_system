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
/** 尝试加载 .env.production，失败则从 process.env 读取 */
try { require('dotenv').config({ path: '/data/web_system/.env.production' }); } catch (_) {}

const DB_TYPE = process.env.DB_TYPE || 'mysql';
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USERNAME = process.env.DB_USERNAME || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_DATABASE = process.env.DB_DATABASE || 'web_system';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
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

const logBase = process.env.LOG_BASE || '/data/web_system/logs';

const commonConfig = {
  instances: 1,
  exec_mode: 'fork',
  cwd: '/data/web_system',
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
        AUTH_SERVICE_URL: 'http://127.0.0.1:6001',
        USER_SERVICE_URL: 'http://127.0.0.1:6002',
        AI_SERVICE_URL: 'http://127.0.0.1:6003',
        SYSTEM_SERVICE_URL: 'http://127.0.0.1:6004',
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
        // 财经资讯微服务：同机内网经 gateway 代理（带 Bearer 鉴权 → 6007），不经公网
        FINNEWS_SERVICE_URL: 'http://127.0.0.1:6000/api/finnews',
        FINNEWS_SERVICE_AUTH_TYPE: 'bearer',
        FINNEWS_SERVICE_AUTH_CONFIG: JSON.stringify({
          token: process.env.FINNEWS_SERVICE_KEY || '',
        }),
        // 内容中枢（content-hub，含公众号发布接口）：与财经同机同 key
        CONTENT_HUB_SERVICE_URL: 'http://127.0.0.1:6000/api/content-hub',
        CONTENT_HUB_SERVICE_AUTH_TYPE: 'bearer',
        CONTENT_HUB_SERVICE_AUTH_CONFIG: JSON.stringify({
          token: process.env.FINNEWS_SERVICE_KEY || '',
        }),
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
  ],
};

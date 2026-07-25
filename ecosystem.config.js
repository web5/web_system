/**
 * PM2 部署配置
 *
 * 使用方式：
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *
 * 注意：敏感信息（DB_PASSWORD、JWT_SECRET 等）不要硬编码在此文件中！
 * 生产环境请使用 .env.production 文件或环境变量覆盖。
 */
/** 尝试加载 .env.production，失败则使用 process.env 中的值 */
try { require('dotenv').config({ path: '/data/web_system/.env.production' }); } catch (_) {}

const DB_TYPE = process.env.DB_TYPE || 'mysql';
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USERNAME = process.env.DB_USERNAME || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'web_system_root_2026';
const DB_DATABASE = process.env.DB_DATABASE || 'web_system';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const MINI_PROGRAM_APP_ID = process.env.MINI_PROGRAM_APP_ID || '';
const MINI_PROGRAM_SECRET = process.env.MINI_PROGRAM_SECRET || '';
const OFFICIAL_ACCOUNT_APP_ID = process.env.OFFICIAL_ACCOUNT_APP_ID || '';
const OFFICIAL_ACCOUNT_SECRET = process.env.OFFICIAL_ACCOUNT_SECRET || '';
const WECHAT_OAUTH_REDIRECT_URI = process.env.WECHAT_OAUTH_REDIRECT_URI || '';

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

module.exports = {
  apps: [
    {
      name: 'gateway',
      script: './servers/gateway/dist/main.js',
      cwd: '/data/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        AUTH_SERVICE_URL: 'http://127.0.0.1:3001',
        USER_SERVICE_URL: 'http://127.0.0.1:3002',
        AI_SERVICE_URL: 'http://127.0.0.1:3003',
        SYSTEM_SERVICE_URL: 'http://127.0.0.1:3004',
        TODO_SERVICE_URL: 'http://127.0.0.1:3005',
        PUBLIC_URL: process.env.PUBLIC_URL || 'http://localhost:3000',
        CORS_ORIGINS: '*',
        JWT_SECRET,
      },
      error_file: `${logBase}/gateway-error.log`,
      out_file: `${logBase}/gateway-out.log`,
      log_file: `${logBase}/gateway-combined.log`,
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'auth-service',
      script: './servers/auth-service/dist/main.js',
      cwd: '/data/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
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
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'user-service',
      script: './servers/user-service/dist/main.js',
      cwd: '/data/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        ...baseDbConfig,
      },
      error_file: `${logBase}/user-error.log`,
      out_file: `${logBase}/user-out.log`,
      log_file: `${logBase}/user-combined.log`,
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'ai-service',
      script: './servers/ai-service/dist/main.js',
      cwd: '/data/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
        ...baseDbConfig,
        IMAGE_GEN_API_URL: process.env.IMAGE_GEN_API_URL || 'https://tokenhub.tencentmaas.com',
        IMAGE_GEN_API_KEY: process.env.IMAGE_GEN_API_KEY,
        IMAGE_GEN_MODEL: process.env.IMAGE_GEN_MODEL || 'stable-diffusion-xl',
        BIANBIAN_PUBLIC_BASE_URL: process.env.BIANBIAN_PUBLIC_BASE_URL || process.env.PUBLIC_URL?.replace('http://', 'https://') || 'https://dev.kedouai.com',
      },
      error_file: `${logBase}/ai-error.log`,
      out_file: `${logBase}/ai-out.log`,
      log_file: `${logBase}/ai-combined.log`,
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'system-service',
      script: './servers/system-service/dist/main.js',
      cwd: '/data/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3004,
        ...baseDbConfig,
      },
      error_file: `${logBase}/crawler-error.log`,
      out_file: `${logBase}/crawler-out.log`,
      log_file: `${logBase}/crawler-combined.log`,
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'todo-service',
      script: './servers/todo-service/dist/main.js',
      cwd: '/data/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3005,
        ...baseDbConfig,
        JWT_SECRET,
      },
      error_file: `${logBase}/todo-error.log`,
      out_file: `${logBase}/todo-out.log`,
      log_file: `${logBase}/todo-combined.log`,
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};

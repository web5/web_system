module.exports = {
  apps: [
    {
      name: 'gateway',
      script: './servers/gateway/dist/main.js',
      cwd: '/root/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
        AUTH_SERVICE_URL: 'http://127.0.0.1:3001',
        PUBLIC_URL: 'http://106.52.176.246:3000',
        CORS_ORIGINS: '*'
      },
      error_file: '/root/web_system/logs/gateway-error.log',
      out_file: '/root/web_system/logs/gateway-out.log',
      log_file: '/root/web_system/logs/gateway-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    },
    {
      name: 'auth-service',
      script: './servers/auth-service/dist/main.js',
      cwd: '/root/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        DB_TYPE: 'mysql',
        DB_HOST: 'localhost',
        DB_PORT: '3306',
        DB_USERNAME: 'web_system',
        DB_PASSWORD: 'web_system123',
        DB_DATABASE: 'web_system',
        JWT_SECRET: 'production-secret-key-change-this',
        JWT_EXPIRES_IN: '7d',
        REDIS_URL: 'redis://localhost:6379'
      },
      error_file: '/root/web_system/logs/auth-error.log',
      out_file: '/root/web_system/logs/auth-out.log',
      log_file: '/root/web_system/logs/auth-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    },
    {
      name: 'user-service',
      script: './servers/user-service/dist/main.js',
      cwd: '/root/web_system',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      },
      error_file: '/root/web_system/logs/user-error.log',
      out_file: '/root/web_system/logs/user-out.log',
      log_file: '/root/web_system/logs/user-combined.log',
      time: true,
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M'
    }
  ]
}

/**
 * ESLint 9 flat config（根级，覆盖前端 Web 工程）
 *
 * 背景：仓库此前**没有任何 ESLint 配置文件**，但 `apps/admin`、`apps/portal` 的
 * package.json 里已声明 `lint` / `lint:ci` 脚本 —— 即「脚本能敲，跑起来就报错」，
 * 前端唯一的机器门禁实际只有 `vue-tsc --noEmit`（类型检查）。
 *
 * 依赖可用性：`pnpm-workspace` 配了 `node-linker=hoisted`，
 * eslint / typescript-eslint / eslint-plugin-vue 已被提升到根 node_modules，
 * 因此本配置**不需要新增安装**即可运行（见 docs/development/frontend-best-practices.md）。
 *
 * 分档策略：**存量 warn / 高危 error**。
 * 首次接入不以「仓库一片红」为目标，先跑出基线数字，再逐条把规则升为 error。
 * 少数零容忍项（模板解析错误、debugger、依赖方向）直接设 error。
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import parserVue from 'vue-eslint-parser';

/** 纳入 lint 的前端 Web 工程（小程序与后端服务不在本次范围） */
const FRONTEND_APPS = ['shell', 'portal', 'admin', 'deploy-console'];
const FRONTEND_FILES = [
  ...FRONTEND_APPS.map((a) => `apps/${a}/**/*.{ts,vue}`),
  'packages/ui/**/*.{ts,vue}',
];

/** 给不带 files 的预设套上作用范围，避免误伤后端 servers/ 与脚本 */
function scope(preset) {
  const list = Array.isArray(preset) ? preset : [preset];
  return list.map((cfg) => ({ ...cfg, files: FRONTEND_FILES }));
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-*/**',
      '**/public/**',
      '**/coverage/**',
      '**/*.min.js',
      '**/*.d.ts',
      // 非本次范围：小程序 / 后端服务 / 运维脚本 / 归档
      'apps/kedou-ai-minigram/**',
      'apps/mini-app/**',
      'servers/**',
      'archive/**',
      'scripts/**',
    ],
  },

  ...scope(js.configs.recommended),
  ...scope(tseslint.configs.recommended),
  // essential 而非 recommended：只拦会出错的写法，风格类交给后续 prettier 收敛
  ...scope(pluginVue.configs['flat/essential']),

  {
    files: FRONTEND_FILES,
    languageOptions: {
      parser: parserVue,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
        ...globals.node,
      },
    },
    rules: {
      /* ===== 零容忍（error）：存量应当为 0，出现即阻断 ===== */
      // 调试语句残留由 js.configs.recommended 内置的同名规则覆盖（error 级），
      // 此处不再重复声明（重复声明还会撞上 CI 红线 R1 的关键字扫描）。
      'vue/no-parsing-error': 'error',
      'no-var': 'error',

      /* ===== 依赖方向：packages 不得反向依赖 apps ===== */
      // 见下方 overrides（每个作用域单独声明，便于报错信息指明方向）

      /* ===== 存量收敛项（warn）：先看清数字，再逐个升 error ===== */
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
      'vue/no-v-html': 'warn',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',

      /* ===== 刻意关闭 ===== */
      // 存量存在大量单文件组件名，改名成本高、收益低
      'vue/multi-word-component-names': 'off',
    },
  },

  // packages/* 不得反向依赖 apps/*
  {
    files: ['packages/**/*.{ts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**'],
              message: '依赖方向违规：packages 不得反向依赖 apps。共享逻辑请留在 packages 内。',
            },
          ],
        },
      ],
    },
  },

  // 跨 app 禁止直连：portal ↔ admin ↔ deploy-console …
  ...FRONTEND_APPS.map((app) => ({
    files: [`apps/${app}/**/*.{ts,vue}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: FRONTEND_APPS.filter((o) => o !== app).map((o) => ({
            group: [`**/apps/${o}/**`, `**/${o}/src/**`],
            message: `跨 app 直连禁止：${app} → ${o}。共享逻辑请下沉 packages/shared | packages/ui | packages/types。`,
          })),
        },
      ],
    },
  })),
);

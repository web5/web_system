/**
 * ESLint 9 flat config（servers/* 后端服务共享）
 *
 * 背景：仓库根级 `eslint.config.mjs` 的 `ignores` 明确含 `'servers/**'`（注释写明
 * 「后端服务不在本次范围」），但 auth-service / gateway / knowledge-service /
 * mcp-gateway / todo-service / user-service 六个包的 package.json 里留着 nest
 * 脚手架的 `lint` / `lint:ci` 脚本——于是形成「脚本能敲、跑起来就报错」的死配置：
 *   $ cd servers/user-service && pnpm lint:ci
 *   You are linting "{src,apps,libs,test}/<glob>.ts", but all of the files matching
 *   the glob pattern ... are ignored.   （ESLint 9 exit 2）
 * 根因是 ESLint 9 从 cwd 向上解析配置时命中了根级那份，servers 文件全被 ignore。
 *
 * 解法：本文件放在 `servers/` 目录，是 ESLint 9「最近配置优先」下的解法——
 * 在 `servers/<pkg>` 下运行 lint 时先命中本文件、不再向上找到根配置，
 * 根级那份的 `servers/**` ignore 自然不生效（根配置保持不动，两边职责不重叠）。
 * 例外：`servers/gateway` 自带包级 `eslint.config.mjs`，就近性更高，继续用它那份；
 * 本文件只兜其余没有包级配置的后端包。
 *
 * 分档策略（沿用仓库根级配置的既定方针）：**存量 warn / 高危 error**。
 * 首次接入不以「仓库一片红」为目标，先跑出基线数字，再逐条把规则升为 error。
 * 为此**不改任何业务代码**去凑 lint，预设里在存量上报 error 的规则降 warn 建基线。
 *
 * 作用域：`servers/<pkg>/{src,apps,libs,test}` 下的全部 .ts，与各包 lint:ci
 * 脚本的 glob 对齐（现实现都在 src，apps/libs/test 留作脚手架默认位）。
 * type-aware 规则不开：避免每包折腾 tsconfig 项目引用，收益也有限。
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** 各后端包 lint 脚本的实际作用面（相对本文件所在目录 servers/） */
const BACKEND_FILES = [
  '*/src/**/*.ts',
  '*/apps/**/*.ts',
  '*/libs/**/*.ts',
  '*/test/**/*.ts',
];

/** 给不带 files 的预设套上作用范围，避免规则外溢 */
function scope(preset) {
  const list = Array.isArray(preset) ? preset : [preset];
  return list.map((cfg) => ({ ...cfg, files: BACKEND_FILES }));
}

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-*/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },

  // 后端纯 TS，不需要 vue 相关预设
  ...scope(js.configs.recommended),
  ...scope(tseslint.configs.recommended),

  {
    files: BACKEND_FILES,
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      /* ===== 零容忍（error）：存量应当为 0，出现即阻断 ===== */
      // 调试语句残留由 js.configs.recommended 内置的同名规则覆盖（error 级），
      // 此处不再重复声明（重复声明还会撞上 CI 红线 R1 的关键字扫描）。
      'no-var': 'error',

      /* ===== 存量收敛项（warn）：先看清数字，再逐个升 error ===== */
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // 推荐预设默认 error，但存量（auth-service 的 jest mock 等）留有 require() 式
      // 引入，降 warn 建基线，收敛到 0 后再升 error
      '@typescript-eslint/no-require-imports': 'warn',
      'no-console': 'warn',
      eqeqeq: ['warn', 'smart'],
      'prefer-const': 'warn',
    },
  },
);

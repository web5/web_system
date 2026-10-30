/**
 * ESLint 9 flat config —— servers/gateway（后端服务包自有配置）
 *
 * ── 为什么 gateway 需要自己的配置（而不是复用仓库根级那份）─────────────────
 *   根级 eslint.config.mjs（2026-10-10 落地）的 `ignores` 里写了 `'servers/**'`，
 *   注释写明「非本次范围：小程序 / 后端服务 / 运维脚本 / 归档」——
 *   也就是说**后端服务包从来没被 ESLint 覆盖过**。
 *   但 servers/gateway/package.json 里的 `lint` / `lint:ci` 脚本是存在的，
 *   于是产生一个「脚本能敲、跑起来就报错」的死配置：
 *     $ eslint "<包内 lint:ci 脚本里那个 src 下的 ts glob>"
 *     You are linting "..." but all of the files matching the glob pattern "..." are ignored.
 *     ESLint 9 对此直接 exit 2。
 *   本文件是 ESLint 9「最近配置优先」规则下的解法：gateway 目录自带配置，
 *   ESLint 在 gateway 下运行时只认这一份，根级那份的 `servers/**` ignore 不再生效。
 *
 *   ⚠️ 这个缺陷是**存量**的、不是某次改动引入的：把改动全部撤掉、
 *      在 origin/master 基线上跑同一条命令，报错完全一样（exit 2）。
 *      它会在「PR 改动了 servers/gateway」时被 CI 的「改动包 build/test」
 *      选中该包 → 跑到 lint:ci → 整个 job 失败 → PR 卡在 BLOCKED 合不进去。
 *
 * ── 分档策略（沿用仓库根级配置的既定方针）────────────────────────────────
 *   根级配置写明：「存量 warn / 高危 error。首次接入不以『仓库一片红』为目标，
 *   先跑出基线数字，再逐条把规则升为 error。」
 *   本文件照此执行，接入时实测基线为：**0 error / 72 warning**
 *   （63 × no-explicit-any + 9 × no-unused-vars），因此可以**原样启用
 *   js.configs.recommended + typescript-eslint recommended 的全部 error 级规则**，
 *   不需要为了「让它变绿」而关掉任何高危规则。
 *
 *   唯一关掉的规则及理由：
 *   - no-undef：TypeScript 的类型系统已经覆盖了「未定义标识符」，
 *     再叠一层 base 规则会对 TS 特有的全局（process / Buffer / __dirname 等）
 *     产生误报，属于 TS 项目里的公认冗余规则。
 *
 * ── 后续收敛路径（不在本次范围内）────────────────────────────────────────
 *   1) 63 处 no-explicit-any 逐个收敛为 unknown + 显式收窄，
 *      收敛到 0 后把该规则从 warn 升为 error；
 *   2) 9 处 no-unused-vars 清理完再升 error；
 *   3) 同款死配置还存在于另外 5 个后端包（auth-service / knowledge-service /
 *      mcp-gateway / todo-service / user-service），应按同一模式补齐。
 *      —— 本次只修 gateway：只有它挡住了本次修复入主干；
 *         其余 5 个包在各自 PR 触达时再补，避免一次改动面铺得过大。
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      // TypeScript 类型系统已覆盖「未定义标识符」，base 规则在 TS 项目里公认冗余
      'no-undef': 'off',

      // 存量项：先留 warn，收敛到 0 后升 error（见文件头「后续收敛路径」）
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
);

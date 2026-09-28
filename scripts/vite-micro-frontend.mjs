// 微前端模块化 vite 配置工厂。
// 供各业务模块（portal/admin）在 vite.config.ts 的 mode=mf 分支调用。
//
// 产出 UMD 格式，挂到 window.__MODULES__[<name>]；external 公共依赖（从基座 window.__SHARED__ 取）；
// postcss 给每条 CSS 选择器加 [data-module="<name>"] 前缀做样式隔离。
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { appVersionDefine, appVersionPlugin } from './vite-app-version.mjs';
import { publicAssetDefine } from './vite-public-assets.mjs';

// 默认 externals 映射：模块 external 这些 key，运行时从 window.__SHARED__ 对应字段取
// ⚠️ globals 值必须是「点链」访问（rollup UMD 不支持 ["..."] 括号，会生成错误代码），
//    故 __SHARED__ 的 key 用 camelCase（vueRouter / antDesignVue 等），避免连字符
const DEFAULT_EXTERNALS = {
  vue: 'window.__SHARED__.vue',
  'vue-router': 'window.__SHARED__.vueRouter',
  pinia: 'window.__SHARED__.pinia',
  axios: 'window.__SHARED__.axios',
  dayjs: 'window.__SHARED__.dayjs',
  'ant-design-vue': 'window.__SHARED__.antDesignVue',
  '@ant-design/icons-vue': 'window.__SHARED__.antDesignIconsVue',
};

/**
 * 解析 `RELEASE_TAG` → 产物 base。
 *
 * 契约：1 段或 2 段均合法（二者都在生产使用，勿再互相"纠正"）：
 * - **2 段** `<流水线key>/<commit>`：平台流水线默认形态（p20+ 约定，见 `scripts/migrations/p22-app-artifact-env-dir.mjs`）；
 *   env-dir 应用此时产品线段取 envId，投递落 `modules/<key>/<envId>/<commit>/`（`specs/app-artifact-env-dir` G2）。
 * - **1 段** `<commit>`：本地 `scripts/build-module.mjs` / `scripts/deploy.sh` 的形态（历史扁平）。
 *
 * **为什么 2026-09-28 起不再强制 2 段、也不再需要逃生舱**：
 *   第二段存在的意义是让产物内 public 资源（logo / avatars / materials）落在与投递目录
 *   逐字一致的 base 下 —— 少一段就静默 404。这些资源已于 2026-09-27 全部迁到
 *   `/static/cdn/pub/`（编译期常量 `__PUBLIC_ASSET_BASE__`，见 assets/shared-public/README.md），
 *   产物只剩 index.js / index.css / manifest.json，**base 已与资源路径解耦**。
 *
 *   此前强制 2 段的实际后果是同一个仓三套写法并存：`build-module.mjs` 硬写 `default/<commit>`、
 *   `deploy.sh` 写扁平却必须配 `MF_ALLOW_FLAT_BASE=1` 绕过本函数校验、而线上 NEW 域入口
 *   是 `<key>/<envId>/index.js` 指针 —— 任何一处调整都会产出「构建成功但路径对不上」的产物。
 *   现统一：**段数由发布方决定，此处只做合法性校验（字符 + ≤2 段）**。
 */

/** base 路径段的合法字符（禁空格/引号/`..` 等，避免拼进 URL 与远端部署路径） */
const TAG_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function resolveMfBase(name, rawTag = process.env.RELEASE_TAG) {
  const tag = String(rawTag ?? '').trim();
  if (!tag) {
    throw new Error(
      `[mf] 缺少 RELEASE_TAG：产物 base 需要 /static/modules/${name}/<版本>/。\n` +
        `     本地构建示例：RELEASE_TAG=$(git rev-parse --short HEAD) MF_FORMAT=system npx vite build --mode mf\n` +
        `     走发布流水线时由平台注入 <templateKey>/<commit> 或纯 <commit>，无需手工传。`,
    );
  }

  const segments = tag.split('/').filter((s) => s.length > 0);
  for (const seg of segments) {
    if (!TAG_SEGMENT_RE.test(seg)) {
      throw new Error(`[mf] RELEASE_TAG 段 "${seg}" 含非法字符（仅允许字母/数字/. _ -）：${tag}`);
    }
  }
  if (segments.length > 2) {
    throw new Error(
      `[mf] RELEASE_TAG 最多两段（<命名空间>/<版本>），当前收到 ${segments.length} 段：${tag}`,
    );
  }
  // 两段是 env-dir 的正当形态（`specs/app-artifact-env-dir` G2：产品线段 = envId，
  // 投递落 modules/<key>/<envId>/<commit>/），不告警；仅由上方 JSDoc 说明其与扁平的差异。
  return `/static/modules/${name}/${segments.join('/')}/`;
}

/**
 * 生成微前端模块的 vite 配置。
 * 调用方在 vite.config.ts 里：
 *   export default defineConfig(({ mode }) => mode === 'mf' ? microFrontendConfig({ name: 'portal' }) : standaloneConfig)
 *
 * 构建产物：dist/index.js + dist/index.css + dist/manifest.json（manifest 由 build-module.mjs 写）
 */
export function microFrontendConfig(opts) {
  const { name, entry = 'src/main.ts' } = opts;
  // 支持 MF_FORMAT 环境变量：**默认 system**（2026-09-28 起）。
  //
  // 为什么要改默认值：umd 只能产出**单文件整包**（admin index.js 1.93MB / portal 2.21MB，
  // 首屏必须先下完才能渲染），且主业务以外的路由、echarts（519KB）也一并打进去。
  // 改 system 后 rollup 按路由分包：入口 index.js 退化为几百字节的 System.register shim，
  // 其余 chunk 按需拉取；配合 gateway 的 preload 与 gateway 对 /static/modules/ 下
  // 带 hash 分包的 immutable 缓存，首屏体积与回访命中率同步改善。
  //
  // loader 同时支持两种格式（system 主路径 / umd 旧产物兼容），且官方文档、
  // deploy.sh / deploy-local.sh / 流水线配置历来写的都是 MF_FORMAT=system ——
  // 这里只是让**不显式传 MF_FORMAT 的构建入口**（如 scripts/build-module.mjs）不再退化成 umd。
  // 需要旧行为时显式传 MF_FORMAT=umd 即可。
  const format = opts.format || process.env.MF_FORMAT || 'system';
  const externals = { ...DEFAULT_EXTERNALS, ...(opts.externals || {}) };
  // 模块名中的连字符转下划线，作为 UMD 全局变量名后缀
  const globalName = `__modules_${name.replace(/[-/]/g, '_')}`;
  // 产物 base（含产品线段）由 RELEASE_TAG 决定，校验规则见 resolveMfBase
  const publicBase = resolveMfBase(name);

  return defineConfig({
    base: publicBase,
    define: {
      // 模块独立打包为 UMD 在浏览器运行，必须替换 process.env.NODE_ENV / process.env，
      // 否则 rollup 保留 `process.env.NODE_ENV !== "production"` 等表达式，浏览器无 process 全局
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env': JSON.stringify({ NODE_ENV: 'production' }),
      // 公共静态资源前缀 /static/cdn/pub/ —— 资源不随版本投递，避免「双段目录」错一段即 404
      ...publicAssetDefine(),
    },
    plugins: [appVersionPlugin(), vue(), cssScopePlugin(name)],
    resolve: {
      alias: {
        '@': resolve(process.cwd(), 'src'),
        '@web-system/shared': resolve(process.cwd(), '../../packages/shared/src/index.ts'),
        // 与 standalone 模式（apps/*/vite.config.ts）同口径：该包未在 portal 的
        // package.json 声明，靠 alias 指到源码；MF 缺这条会 rollup 解析失败。
        '@web-system/agent-message': resolve(
          process.cwd(),
          '../../packages/agent-message/src/index.ts',
        ),
      },
    },
    // system 格式：普通 build + rollup format=system，支持 code-splitting（所有 chunk 均为 System.register）
    // umd 格式：lib 模式单文件（旧产物兼容，不支持分包）
    build:
      format === 'system'
        ? {
            outDir: 'dist',
            sourcemap: false,
            cssCodeSplit: false,
            emptyOutDir: true,
            // 用 terser 压缩并移除 console/debugger，减小产物体积
            minify: 'terser',
            terserOptions: {
              compress: { drop_console: true, drop_debugger: true },
            },
            rollupOptions: {
              input: entry,
              external: Object.keys(externals),
              // ⚠️ 必须（且只能在「输入选项」这一层，放 output 里会被 Rollup 判为 Unknown output options 而静默忽略）：
              // 入口是微前端「远端模块」，它的导出就是对外契约（default = lifecycle）。
              // 默认（未设）时 Rollup 认为入口导出无人使用，会把导出名压缩/重写成 exports("l", …)
              // 这类单字母，default 直接消失 → 基座 shell-loader 的 System.import 分支拿不到 mount，
              // 只能靠产物末尾的 window.__MODULES__ 全局副作用 + UMD 回退侥幸挂载
              // （两条路径都不成立时，页面表现为「一直 loading 且无任何报错」）。
              // 设 'strict' 后 index.js 保留 export default / 命名导出，加载路径确定。
              preserveEntrySignatures: 'strict',
              output: {
                format: 'system',
                entryFileNames: 'index.js',
                chunkFileNames: '[name].[hash].js',
                assetFileNames: 'index.[ext]',
                globals: externals,
              },
            },
          }
        : {
            outDir: 'dist',
            sourcemap: false,
            cssCodeSplit: false,
            emptyOutDir: true,
            minify: 'terser',
            terserOptions: {
              compress: { drop_console: true, drop_debugger: true },
            },
            lib: {
              entry,
              formats: ['umd'],
              name: globalName,
              fileName: () => 'index.js',
            },
            rollupOptions: {
              external: Object.keys(externals),
              output: {
                globals: externals,
                assetFileNames: 'index.[ext]',
              },
            },
          },
  });
}

/**
 * postcss 插件：给每条 CSS 选择器加 :where([data-module="<name>"]) 前缀。
 * 模块根容器 <div data-module="<name>"> 包裹，样式只命中模块内 DOM。
 *
 * 为什么用 :where() 包裹前缀：
 *   antdv 4.x 的组件样式是 cssinjs 运行时生成的，用 :where() 包裹（优先级归零）。
 *   若前缀用 [data-module="xxx"]（属性选择器，优先级 +0,1,0），会让模块里任何
 *   低优先级规则（如 `* { padding:0 }`、`body { color }`）都比 antdv 默认样式高，
 *   大面积误伤 antdv 组件（Input padding 清零、按钮白色文字变深、hover 失效）。
 *   改成 :where() 后前缀优先级归零，模块 CSS 与 antdv 恢复正常的层叠关系。
 *
 * html/body/:root/[data-theme] 选择器不加前缀（保持全局）：
 *   - :root/[data-theme] 定义 CSS 变量，作用在 <html> 上；变量跨模块冲突已由
 *     shell-loader 在 unmount 时 removeCss 解决（单模块挂载场景）。
 *   - html/body 设置页面背景/字体，由模块统一维护。
 */
function cssScopePlugin(moduleName) {
  const prefix = `:where([data-module="${moduleName}"])`;
  return {
    name: 'micro-frontend-css-scope',
    config() {
      return {
        css: {
          postcss: {
            plugins: [
              {
                postcssPlugin: 'micro-frontend-scope',
                Once(root) {
                  root.walkRules((rule) => {
                    if (!rule.selectors) return;
                    rule.selectors = rule.selectors.map((sel) => {
                      // html/body/:root/[data-theme=...] 全局选择器不加前缀
                      if (/^\s*(html|body|:root)/.test(sel) || /^\s*\[data-theme/.test(sel)) return sel;
                      if (sel.includes('[data-module')) return sel;
                      return `${prefix} ${sel}`;
                    });
                  });
                },
              },
            ],
          },
        },
      };
    },
  };
}

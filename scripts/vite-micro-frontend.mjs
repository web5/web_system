// 微前端模块化 vite 配置工厂。
// 供各业务模块（portal/admin）在 vite.config.ts 的 mode=mf 分支调用。
//
// 产出 UMD 格式，挂到 window.__MODULES__[<name>]；external 公共依赖（从基座 window.__SHARED__ 取）；
// postcss 给每条 CSS 选择器加 [data-module="<name>"] 前缀做样式隔离。
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { appVersionDefine, appVersionPlugin } from './vite-app-version.mjs';

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
 * 产物 base 的第二段：产品线（= 发布模板 key）。平台默认模板 key 为 `default`，
 * 版本目录布局为 `/static/modules/<name>/<产品线>/<版本>/`。
 */
const DEFAULT_PRODUCT_SEGMENT = 'default';

/** base 路径段的合法字符（禁空格/引号/`..` 等，避免拼进 URL 与远端部署路径） */
const TAG_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * 解析 `RELEASE_TAG` → 产物 base。
 *
 * 契约：`<产品线>/<版本>`（流水线注入的是 `<templateKey>/<commit>`，如 `default/4caf272`）。
 *
 * 为什么「缺产品线段」直接报错而不是兜底一个默认值：
 *   历史缺陷——只传纯 commit（`RELEASE_TAG=4caf272`）时，base 会少一层产品线段：
 *   产物请求 `/static/modules/admin/4caf272/logo.svg`，而它实际部署在
 *   `/static/modules/admin/default/4caf272/` —— 于是 logo.svg / favicon.svg / avatars/*
 *   等 public 资源全部 404，且**构建期没有任何提示**（产物照常生成、页面照常能开）。
 *   这类「静默产出坏产物」的代价远高于构建失败，故此处 fail-fast。
 *
 * 逃生舱：确需历史扁平 base（`/static/modules/<name>/<版本>/`）时显式设
 *   `MF_ALLOW_FLAT_BASE=1`，此时按单段拼 base 并打印告警（仅用于兼容旧发布链路）。
 */
export function resolveMfBase(name, rawTag = process.env.RELEASE_TAG) {
  const tag = String(rawTag ?? '').trim();
  if (!tag) {
    throw new Error(
      `[mf] 缺少 RELEASE_TAG：产物 base 需要 /static/modules/${name}/<产品线>/<版本>/。\n` +
        `     本地构建示例：RELEASE_TAG=${DEFAULT_PRODUCT_SEGMENT}/$(git rev-parse --short HEAD) MF_FORMAT=system npx vite build --mode mf\n` +
        `     走发布流水线时由平台注入 <templateKey>/<commit>，无需手工传。`,
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
      `[mf] RELEASE_TAG 最多两段（<产品线>/<版本>），当前收到 ${segments.length} 段：${tag}`,
    );
  }
  if (segments.length === 1) {
    if (process.env.MF_ALLOW_FLAT_BASE !== '1') {
      throw new Error(
        `[mf] RELEASE_TAG "${tag}" 缺少产品线段，应为 "${DEFAULT_PRODUCT_SEGMENT}/${tag}"。\n` +
          `     缺段会让 base 少一层，产物内 public 资源（logo.svg/favicon.svg/avatars 等）会静默 404。\n` +
          `     确需历史扁平 base 时显式设 MF_ALLOW_FLAT_BASE=1。`,
      );
    }
    console.warn(
      `[mf] MF_ALLOW_FLAT_BASE=1：RELEASE_TAG="${tag}" 未带产品线段，按扁平 base 构建（历史兼容，勿用于新发布）`,
    );
  }

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
  // 支持 MF_FORMAT 环境变量：umd（默认，兼容现状）| system（SystemJS，可分包）
  const format = opts.format || process.env.MF_FORMAT || 'umd';
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
    },
    plugins: [appVersionPlugin(), vue(), cssScopePlugin(name)],
    resolve: {
      alias: {
        '@': resolve(process.cwd(), 'src'),
        '@web-system/shared': resolve(process.cwd(), '../../packages/shared/src/index.ts'),
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

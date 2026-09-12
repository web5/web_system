import { isContentAddressed } from './static.module';

/**
 * 缓存判定单测。
 *
 * 背景（2026-09-11 事故）：dev.kedouai.com/admin 在 Chrome 下白屏 —— 固定名入口
 * `index.js` / `index.css` 被误判为"内容寻址"，网关下发 immutable 一年，浏览器
 * 永远使用旧入口，引用的旧分包已被删除 → 动态 import 404 → 首屏导航失败且无日志。
 *
 * 这里锁死判定规则：**按「路径是否随内容变化」判定，而不是按目录前缀**。
 */
describe('isContentAddressed（静态资源缓存判定）', () => {
  const ROOT = '/data/web_system/servers/gateway/public';

  describe('固定名入口 → 非内容寻址（必须 no-cache）', () => {
    it('模块入口 index.js', () => {
      expect(isContentAddressed(`${ROOT}/static/modules/admin/default/12e8c60/index.js`)).toBe(false);
    });

    it('模块样式 index.css', () => {
      expect(isContentAddressed(`${ROOT}/static/modules/admin/default/12e8c60/index.css`)).toBe(false);
    });

    it('legacy 扁平布局（无产品线段）的入口同样不缓存', () => {
      expect(isContentAddressed(`${ROOT}/static/modules/admin/12e8c60/index.js`)).toBe(false);
      expect(isContentAddressed(`${ROOT}/static/modules/portal/0f9bfb3/index.css`)).toBe(false);
    });

    it('入口名大小写不敏感', () => {
      expect(isContentAddressed(`${ROOT}/static/modules/admin/default/12e8c60/Index.JS`)).toBe(false);
    });
  });

  describe('带 hash 的模块分包 → 内容寻址（immutable）', () => {
    it('主 chunk main.<hash>.js', () => {
      expect(isContentAddressed(`${ROOT}/static/modules/admin/default/12e8c60/main.DLIcP3_K.js`)).toBe(true);
    });

    it('路由懒加载分包 <View>.<hash>.js', () => {
      expect(isContentAddressed(`${ROOT}/static/modules/portal/default/0f9bfb3/AiChat.IjjyUx09.js`)).toBe(true);
      expect(isContentAddressed(`${ROOT}/static/modules/admin/default/12e8c60/BasicLayout.DjHt8TrX.js`)).toBe(true);
    });

    it('模块内的图片/字体资源仍按 hash 文件名判定', () => {
      expect(isContentAddressed(`${ROOT}/static/modules/admin/default/12e8c60/logo.a1b2c3d4.svg`)).toBe(true);
    });
  });

  describe('自建 CDN 目录 → 非内容寻址（文件名固定，依赖升级必须能更新）', () => {
    it('vue.js / antd.js 等固定名外部依赖', () => {
      expect(isContentAddressed(`${ROOT}/static/cdn/vue.js`)).toBe(false);
      expect(isContentAddressed(`${ROOT}/static/cdn/dayjs-advancedFormat.js`)).toBe(false);
    });
  });

  describe('Vite 产物 assets/* → 内容寻址（immutable）', () => {
    it('/assets/ 与前缀级 /<pub>/assets/', () => {
      expect(isContentAddressed(`${ROOT}/assets/index.C8T6z3bs.js`)).toBe(true);
      expect(isContentAddressed(`${ROOT}/admin/assets/Table.a1b2c3d4.css`)).toBe(true);
    });
  });

  describe('指针型文件 → 非内容寻址', () => {
    it('index.html / version.json 不缓存', () => {
      expect(isContentAddressed(`${ROOT}/shell/index.html`)).toBe(false);
      expect(isContentAddressed(`${ROOT}/shell/version.json`)).toBe(false);
    });
  });

  describe('兜底规则：文件名自带 8 位以上 hash', () => {
    it('任意目录下的 hash 资源都强缓存', () => {
      expect(isContentAddressed(`${ROOT}/materials/svg/icon.9f8e7d6c.svg`)).toBe(true);
    });

    it('无 hash 的普通文件不强缓存', () => {
      expect(isContentAddressed(`${ROOT}/materials/svg/icon.svg`)).toBe(false);
    });
  });

  it('Windows 反斜杠路径也能正确判定', () => {
    expect(isContentAddressed(`${ROOT}\\static\\modules\\admin\\default\\12e8c60\\index.js`)).toBe(false);
  });
});

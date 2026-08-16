/**
 * Portal 微前端模块入口。
 * UMD 打包时由 rollup 挂到 window.__modules_portal；
 * 这里手动挂到 window.__MODULES__['portal'] 兜底（dev 直跑也生效）。
 */
import { bootstrap, mount, unmount } from './lifecycle';

const lifecycle = { bootstrap, mount, unmount };

if (typeof window !== 'undefined') {
  (window as any).__MODULES__ = (window as any).__MODULES__ || {};
  (window as any).__MODULES__['portal'] = lifecycle;
}

export default lifecycle;

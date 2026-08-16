/** Admin 微前端模块入口。UMD 打包挂到 window.__modules_admin；这里兜底挂 window.__MODULES__。 */
import { bootstrap, mount, unmount } from './lifecycle';
const lifecycle = { bootstrap, mount, unmount };
if (typeof window !== 'undefined') {
  (window as any).__MODULES__ = (window as any).__MODULES__ || {};
  (window as any).__MODULES__['admin'] = lifecycle;
}
export default lifecycle;

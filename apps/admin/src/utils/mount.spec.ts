/**
 * moduleOverlayContainer 的单测。
 *
 * 这个函数的唯一职责是「浮层别落到 body 上」，所以测试只盯三件事：
 * 有模块容器时选它、没有时能退回 body、别把 <head> 里标记 CSS 的 link 当成容器。
 * 第一、三条任一失效，抽屉里的样式会整片消失（2026-10-23 线上事故形态）。
 */
import { moduleOverlayContainer } from './mount';

describe('moduleOverlayContainer', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('微前端模式：选中模块容器而不是 body', () => {
    const host = document.createElement('div');
    host.className = 'module-container';
    host.setAttribute('data-module', 'admin');
    document.body.appendChild(host);

    expect(moduleOverlayContainer()).toBe(host);
  });

  it('standalone 模式：没有容器时退回 body', () => {
    expect(moduleOverlayContainer()).toBe(document.body);
  });

  it('忽略 <head> 里标记模块 CSS 的 link[data-module]', () => {
    const link = document.createElement('link');
    link.setAttribute('data-module', 'admin');
    document.head.appendChild(link);

    expect(moduleOverlayContainer()).toBe(document.body);
  });
});

/// <reference types="node" />
/**
 * 关于页版本号展示接线（1.0.18 · 问题 1）
 *
 * 🔴 这是「1.0.17 线上包显示 v1.0.0」的直接回归网：
 *    - about.wxml 里不得再出现字面量版本号（否则下次 bump 又会漏）；
 *    - 必须绑定 {{appVersion}}（模板侧真的用上了运行期解析结果）；
 *    - about.ts 必须把 resolveAppVersion() 的结果放进 data，否则 wxml 绑了个 undefined。
 *
 * 用 fs 读源文本而不是 import about.ts：该文件顶层是 `Page({...})`，
 * 在 jest 里 import 需要额外全局桩，且本测试要断言的正是「源码里写了什么」。
 */
import * as fs from 'fs';
import * as path from 'path';

const ABOUT_DIR = path.join(__dirname, '..', 'pages', 'mine', 'about');
const wxml = fs.readFileSync(path.join(ABOUT_DIR, 'about.wxml'), 'utf-8');
const ts = fs.readFileSync(path.join(ABOUT_DIR, 'about.ts'), 'utf-8');

describe('about.wxml · 版本号改绑定', () => {
  it('不再出现字面量版本号 v1.0.0（1.0.17 缺陷本体）', () => {
    expect(wxml).not.toMatch(/v1\.0\.0/);
  });

  it('不再出现任何字面量 vX.Y.Z 版本号（防下次 bump 又写死）', () => {
    expect(wxml).not.toMatch(/v\d+\.\d+\.\d+/);
  });

  it('版本号节点绑定 {{appVersion}}', () => {
    expect(wxml).toMatch(/<view class="ver">v\{\{\s*appVersion\s*\}\}<\/view>/);
  });
});

describe('about.ts · 运行期解析接线', () => {
  it('从 utils/version 引入 resolveAppVersion', () => {
    expect(ts).toMatch(/import\s*\{\s*resolveAppVersion\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/utils\/version'/);
  });

  it('data 里有 appVersion 字段（首帧即有值）', () => {
    expect(ts).toMatch(/appVersion\s*:\s*resolveAppVersion\(\)/);
  });

  it('onLoad 里再赋一次（防初始 data 在页面实例化前求值）', () => {
    // 抓 onLoad 方法体（Page 对象内方法缩进 2 空格，以 `\n  },` 收尾）
    const m = ts.match(/onLoad\s*\([^)]*\)\s*\{([\s\S]*?)\n {2}\},/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/setData\(\s*\{\s*appVersion\s*:\s*resolveAppVersion\(\)\s*\}\s*\)/);
  });
});

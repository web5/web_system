/// <reference types="node" />
/**
 * WXML 注释守卫 · 接线入口（kedou 侧）
 *
 * 判据（R1 裸 `<` / R2 注释边界字面量 / R3 注释落在开始标签属性列表内部）、扫描面与**全部断言**
 * 唯一实现在仓库根共享层 `scripts/lib/wxml-lt-guard.ts`（`registerWxmlLtGuardSpecs`）。
 *
 * 🔴 本文件只做接线：**不许写断言、不许复制规则**。判据改一处，两个 app 同时生效。
 * 为什么两个 app 各留一个入口（而不是共享一个）：`scripts/ci/changed-packages.sh:25-27`
 * 按 diff 取 `apps/<pkg>`、`:86-97` 逐包跑 test —— 只留一个入口的话，改大橙子的 CI 跑不到科豆的网。
 *
 * 为什么科豆要有这张网（本文件是本轮**新增**的）：R3 原先只写在大橙子侧，科豆**零覆盖**。
 * 两个 app 的 WXML 写法同源（同一批人、同一套组件习惯），大橙子炸过一次的地方科豆一次都没查过。
 * 现状（2026-11-27 实测）：科豆 37 个 wxml，R1 / R2 / R3 **均 0 命中** —— 本文件是防回归守卫，不是修 bug。
 */
import * as path from 'path';
import { registerWxmlLtGuardSpecs } from '../../../scripts/lib/wxml-lt-guard';

registerWxmlLtGuardSpecs({
  // 扫描根必须由接线方算好传进来（在 app 的 tests 目录下 `..` 才是 app 根）
  appRoot: path.resolve(__dirname, '..'),
  // 防空转锚点：custom-tab-bar 生命周期稳定、不随业务改版消失；
  // contract/index 是带多行开始标签与注释的真实业务页
  mustScan: ['custom-tab-bar/index.wxml', 'packageContract/pages/contract/index/index.wxml'],
  minFiles: 20, // 实际 37 个 wxml，取明显下界
});

/// <reference types="node" />
/**
 * WXML 注释守卫 · 接线入口（dachengzi 侧）
 *
 * 判据（R1 裸 `<` / R2 注释边界字面量 / R3 注释落在开始标签属性列表内部）、扫描面与**全部断言**
 * 唯一实现在仓库根共享层 `scripts/lib/wxml-lt-guard.ts`（`registerWxmlLtGuardSpecs`）。
 *
 * 🔴 本文件只做接线：**不许写断言、不许复制规则**。判据改一处，两个 app 同时生效。
 * 为什么两个 app 各留一个入口（而不是共享一个）：`scripts/ci/changed-packages.sh:25-27`
 * 按 diff 取 `apps/<pkg>`、`:86-97` 逐包跑 test —— 只留一个入口的话，改科豆的 CI 跑不到大橙子的网。
 *
 * 事故背景见共享层文件头：2026-11-27 大橙子整包编译失败（`unexpected character '<'` →
 * pageStack 空 → 所有真机 E2E 全红），三颗雷分别是注释里的裸 `<`、注释正文里的注释边界字面量、
 * 以及注释写进了 `<action-drawer …>` 的属性列表内部。
 */
import * as path from 'path';
import { registerWxmlLtGuardSpecs } from '../../../scripts/lib/wxml-lt-guard';

registerWxmlLtGuardSpecs({
  // 扫描根必须由接线方算好传进来（在 app 的 tests 目录下 `..` 才是 app 根）
  appRoot: path.resolve(__dirname, '..'),
  // 防空转锚点：修复后的 home / detail 正是「多行开始标签 + 紧贴其前的注释」形态
  mustScan: ['pages/nce/detail/detail.wxml', 'pages/home/index/index.wxml'],
  minFiles: 11, // 实际 14 个 wxml，下界放宽
});

/// <reference types="node" />
/**
 * wxml 开发语义文案守护 · 入口（dachengzi 侧）
 *
 * ⚠️ 本文件只做接线，不要在这里写断言、不要在这里写禁词表。
 *    判定规则 / 扫描面 / 负例矩阵唯一实现在 `scripts/lib/no-dev-copy-in-wxml.ts`；
 *    两个 app 各有一个入口，是因为 `scripts/ci/changed-packages.sh` 只跑**改动子包**的 test
 *    （`changed-packages.sh:25-27` 按 diff 取 `apps/<pkg>`，`:86-97` 逐包跑 test），
 *    只留一个入口的话，改 kedou 的 CI 跑不到 dachengzi 的网，反之亦然。
 *    同一条规矩写两份必然漂移 —— 所以两份入口内容一致且只有 2 行代码。
 */
import { registerNoDevCopySpecs } from '../../../scripts/lib/no-dev-copy-in-wxml';

registerNoDevCopySpecs();

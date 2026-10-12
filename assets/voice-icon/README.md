# 语音输入 icon · L1 立弧（v1.0.13 定稿）

语音输入声波图标资产包（**通用版**，monorepo 根级，与 `logo/` 并列；小程序私有即用版在 `apps/kedou-ai-minigram/prototype/assets/voice-icon/`）。**SVG 唯一真源**，位图由 SVG 光栅化产出——圆钮里看到的与方框里看到的永远一致。

构图：实心圆点 + 右侧双层同心弧（微信语音输入同款比例语言），整组在 24 网格内光学居中（圆点偏左是构图的一部分，不是居中对象）。

## 文件速查

| 用途 | 路径 |
|---|---|
| 看整体（三态+参数+用法） | `预览-L1定稿总览.png` |
| WXSS background-image | `base64/wave-orange.b64.txt`（常态橙）/ `base64/wave-white.b64.txt`（录音中白） |
| 原型 inline SVG | `svg/wave-current.svg`（currentColor，抄进 prototype/index.html 的 `#micBtn`） |
| 位图直接引用 | `png/wave-{orange,white,ink}-{288,96,54,27}.png` |
| 换挡改参重跑 | `apps/kedou-ai-minigram/scripts/gen-mic-icon.py` 的 `PARAMS` → 再跑 `build_asset_pack.py <输出目录>` |

## 几何参数（24 网格）

| 项 | 值 |
|---|---|
| 圆点 | cx 6.90 · cy 12 · r 2.5（实心） |
| 内弧 | r 7.25 · `M11.75 6.61 A7.25 7.25 0 0 1 11.75 17.39` |
| 外弧 | r 11.55 · `M14.63 3.42 A11.55 11.55 0 0 1 14.63 20.58` |
| 张角 | ±48°（端点与水平轴夹角；端点与垂直轴夹角 42°，即「立弧」） |
| 线宽 | sw 2.3，全圆头 |
| 整组居中 | dot_cx = 12 − (r2 − dot_r)/2 − sw/4 = 6.90（含线宽补偿） |

**半弧铁律**：上下端点必须同 x、关于水平中线严格镜像（端点 = `(dot_cx + R·cos span, 12 ± R·sin span)`）。端点一偏左一偏右，整条弧就是斜的——J/K 两代「歪」的病根。

## 27px 真机验收（已通过）

- 端点严格镜像，无「八」字外翻
- 点弧细缝 1.35px 吻而不糊；弧间距 2.25px 清晰分层
- 宽 64% × 高 81%，立弧构图

## 迭代链（备查）

J（缝隙≥2格，仍歪）→ K（收张角，顺但方向偏）→ L（端点镜像根治）→ **L1 定稿**。
选型稿归档于工作区 `icon-设计稿/声波-J系列|K系列|L系列/`；完整教训见 skill `icon-design-pipeline` 的 `references/lessons.md`。

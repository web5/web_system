# 变变 — AI Prompt 工程方案

> 版本：v1.0  
> 目标 API：通义万相图生图 / 即梦图生图  
> 输出风格：皮克斯 3D 卡通角色

---

## 一、Prompt 设计原则

| 原则 | 说明 |
|------|------|
| **风格锁定** | 固定皮克斯 3D 卡通，不开放多风格（MVP 阶段） |
| **输出稳定** | 通过精确的控制参数，确保每次输出的一致性 |
| **保留原作** | 绝不对原画做过度解读，不添加原画没有的元素 |
| **孩子气保留** | 不是「完全专业化」，而是「在童趣基础上提升质感」 |
| **安全可控** | 负面 prompt 和内容安全机制并行 |

---

## 二、主 Prompt 模板

### 模板 A：标准版（推荐 MVP 使用）

```
任务：将儿童画转换为 3D 卡通角色。

风格要求：
- 皮克斯 3D 卡通风格（Pixar-style 3D character）
- 圆润可爱，毛绒质感
- 大眼睛，友好表情，适合 6-10 岁儿童审美

姿态控制：
- 全身站立，双手自然垂于身体两侧
- 面朝正前方，平视角度
- 双脚并拢，稳稳站在地面上

背景与构图：
- 纯白色背景（#FFFFFF），无阴影
- 角色居中构图，占画面 70-80%
- 正方形画幅 1024×1024

色彩要求：
- 70% 保留原画的配色方案
- 30% 提升色彩饱和度和质感
- 不改变原画的整体色调感觉

禁止事项：
- 不添加原画中没有的显著元素（翅膀、武器、配饰等）
- 不改变角色的物种/品类（小猫变小狗等）
- 不做过度拟人化处理
- 不添加文字、水印、边框

输出格式：
- PNG，透明背景时回退到纯白背景
- 分辨率 1024×1024
```

### 模板 B：增强版（效果更好时使用）

```
You are a Pixar character designer. Transform this child's drawing into a 3D animated character, following these rules precisely:

STYLE:
- Pixar Animation Studios 3D style
- Soft, rounded, plush-like texture
- Large expressive eyes, friendly face
- Age-appropriate design for 6-10 year old children

POSE:
- Full body standing, facing front
- Arms naturally at sides
- Feet together on flat ground
- Eye-level camera angle

COMPOSITION:
- Pure white background (#FFFFFF)
- Character fills 70-80% of frame
- Square canvas 1024×1024

COLOR FAITHFULNESS:
- Preserve 70% of the original artwork's color palette
- Enhance 30%: slightly boost saturation and add material depth
- Do NOT shift the overall color tone

FORBIDDEN:
- No additional elements not present in the original (wings, weapons, accessories)
- No species/type conversion (cat → dog)
- No over-anthropomorphism
- No text, watermarks, or borders

OUTPUT: PNG with white background, 1024×1024
```

### 模板 C：儿童画专用版（画得比较抽象时）

```
这是一幅孩子的涂鸦，请你理解这幅画的「意图」而不是「形态」。

请做这件事：
1. 首先猜测孩子想画的是什么
2. 然后用皮克斯 3D 卡通风格把它变成一个可爱的角色
3. 保留这幅画的配色感觉（颜色可以优化但不要换色系）
4. 让角色全身站立在白底上，面朝前方
5. 不要添加原作中没有的东西

风格：圆润可爱，皮克斯质感
输出：正方形，白底，1024×1024

特别注意：
- 这是一幅孩子的画，请保留它的「孩子气」
- 不要把它变成过于专业的商业插画
- 角色要可爱但不幼稚
```

---

## 三、负面 Prompt

配合 Stable Diffusion 类 API 使用时（如即梦支持负面提示词），使用以下负面提示：

```
负面提示词：
- 黑暗、恐怖、可怕、血腥、暴力
- 写实照片风格、超写实
- 成人化、性感、暴露
- 畸形手指、多余手指、扭曲肢体
- 文字、字母、水印、签名
- 复杂背景、场景、环境
- 低质量、模糊、噪点
- 3D渲染伪影、塑料质感过重
- 日式动漫风格、美式超级英雄风格
- 阴影、投影、地面阴影
```

---

## 四、参数调优矩阵

### 4.1 风格强度调节

如果 API 支持 `style_strength` 或 `denoising_strength` 参数：

| 强度值 | 效果 | 适用场景 |
|--------|------|---------|
| 0.4-0.5 | 更接近原画，风格变化小 | 孩子画得比较完整、配色清晰 |
| 0.6-0.7 | 平衡点（**推荐默认值**） | 大多数场景 |
| 0.8-0.85 | 更接近 3D 角色，原画痕迹少 | 孩子画得过于抽象，需要 AI 更多「理解」 |

### 4.2 不同画质输入策略

| 输入画质 | Prompt 策略 | 附加处理 |
|---------|------------|---------|
| **清晰涂鸦**（线条明确、配色完整） | 标准模板 A | 无需额外处理 |
| **简笔画**（寥寥几笔） | 模板 C + 降低风格强度到 0.5 | 前端提示「多画几笔会更好看哦」 |
| **抽象色块**（无明确形象） | 模板 C + 风格强度 0.75 | 可能输出不可控，加「不满意？重新变」 |
| **拼贴作品**（素材拼贴） | 标准模板 A + 风格强度 0.65 | 拼接元素可能被理解为配件 |

---

## 五、内容安全前置检查

在发送 AI 请求之前，先做**轻量前端检查**：

```
// 前端检查逻辑（伪代码）

function preCheckImage(image) {
  // 1. 尺寸检查
  if (image.width < 200 || image.height < 200) {
    return { pass: false, reason: '画布内容太小，多画一点吧～' }
  }
  
  // 2. 空白检查（纯白画布）
  if (calculateContentRatio(image) < 0.05) {
    return { pass: false, reason: '画布还是空的哦～放点素材上去吧' }
  }
  
  // 3. 纯色块检查（只有一种颜色的大色块）
  if (calculateColorDiversity(image) < 3) {
    return { pass: false, reason: '多加点颜色会更好看～' }
  }
  
  return { pass: true }
}
```

---

## 六、结果质量评估

每次 AI 返回结果后，后端做快速质量评估：

| 检查项 | 方法 | 不通过处理 |
|--------|------|-----------|
| 角色占比 | 检测主体占画面比例 | < 50%：重新生成 |
| 背景纯净 | 检测背景是否白底 | 非白底：后处理裁剪 |
| 分辨率 | 检查实际输出尺寸 | < 512：重新生成 |
| 内容安全 | 阿里绿网 / 腾讯天御 | 不通过：直接丢弃，提示「换一张画试试」 |

---

## 七、A/B 测试计划

上线后做两组 A/B 测试确定最优 Prompt：

| 实验 | 方案 A | 方案 B | 判定指标 |
|------|--------|--------|---------|
| 风格强度 | 0.6 | 0.7 | 用户保存率 |
| 描述语言 | 中文 Prompt | 英文 Prompt | AI 成功率 |
| 引导文案 | 「描述你的画」选填 | 不提供描述输入 | 变身完成率 |

---

## 八、后续优化方向

- **孩子年龄适配**：未来可让家长设置孩子年龄，Age 5-7 → 更卡通，Age 8-10 → 偏半写实
- **角色序列**：同一角色生成不同姿势（奔跑、跳跃、坐姿），形成「变变表情包」
- **风格实验室**：用户可选风格（水彩、黏土、羊毛毡等），作为付费功能

---

> 文档结束

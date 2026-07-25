/**
 * 变变素材生成脚本
 * 从 @tabler/icons-vue 中提取精选图标的 SVG 字符串，
 * 生成素材配置文件 + 静态 SVG 文件
 *
 * 运行：node scripts/generate-materials.mjs
 */

import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import SELECTED_ICONS from './material-icons.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTAL_ROOT = path.resolve(__dirname, '..');

// 颜色方案（品牌色）
const COLORS = {
  orange: '#FF8C42',
  blue: '#4ECDC4',
  pink: '#FF6B9D',
  purple: '#A78BFA',
  green: '#7ED957',
  yellow: '#FFD93D',
};

// 为不同分类分配默认颜色
const CATEGORY_COLORS = {
  animal: COLORS.orange,
  nature: COLORS.green,
  food: COLORS.pink,
  transport: COLORS.blue,
  sticker: COLORS.purple,
  shape: COLORS.orange,
};

// 分类元信息
const CATEGORIES = {
  animal:    { label: '动物',   icon: 'animal', order: 1 },
  nature:    { label: '自然',   icon: 'nature', order: 2 },
  food:      { label: '食物',   icon: 'food', order: 3 },
  transport: { label: '交通',   icon: 'transport', order: 4 },
  sticker:   { label: '贴纸',   icon: 'sticker', order: 5 },
  shape:     { label: '形状',   icon: 'shape', order: 6 },
};

// 背景主题（渐变背景）
const BACKGROUNDS = [
  { id: 'bg-1', name: '晴天',   category: 'background', type: 'color', content: 'linear-gradient(135deg, #87CEEB 0%, #E0F7FA 100%)' },
  { id: 'bg-2', name: '日落',   category: 'background', type: 'color', content: 'linear-gradient(135deg, #FF8C42 0%, #FFD93D 100%)' },
  { id: 'bg-3', name: '星空',   category: 'background', type: 'color', content: 'linear-gradient(135deg, #2C3E50 0%, #4CA1AF 100%)' },
  { id: 'bg-4', name: '森林',   category: 'background', type: 'color', content: 'linear-gradient(135deg, #7ED957 0%, #4ECDC4 100%)' },
  { id: 'bg-5', name: '粉色',   category: 'background', type: 'color', content: 'linear-gradient(135deg, #FFB6C1 0%, #FFE4E1 100%)' },
  { id: 'bg-6', name: '紫色',   category: 'background', type: 'color', content: 'linear-gradient(135deg, #DDA0DD 0%, #E8D5F5 100%)' },
  { id: 'bg-7', name: '暖白',   category: 'background', type: 'color', content: '#FFF8F0' },
  { id: 'bg-8', name: '海洋',   category: 'background', type: 'color', content: 'linear-gradient(135deg, #4ECDC4 0%, #44A08D 100%)' },
];

async function generate() {
  const materialDefs = [];
  const svgDir = path.join(PORTAL_ROOT, 'public', 'materials', 'svg');

  // 确保目录存在
  fs.mkdirSync(svgDir, { recursive: true });

  // 逐个渲染图标
  for (const item of SELECTED_ICONS) {
    const color = CATEGORY_COLORS[item.category] || COLORS.orange;

    try {
      const mod = await import(`@tabler/icons-vue`);
      const IconComponent = mod[item.iconName];

      if (!IconComponent) {
        console.warn(`[Generate] 未找到图标: ${item.iconName}，跳过`);
        continue;
      }

      // SSR 渲染为 SVG 字符串
      const app = createSSRApp({
        render: () => h(IconComponent, {
          size: 48,
          stroke: 2,
          color: color,
          class: 'material-svg-icon',
        }),
      });

      const svgHtml = await renderToString(app);

      // 保存为 SVG 文件
      const fileName = `material-${item.id}.svg`;
      fs.writeFileSync(path.join(svgDir, fileName), svgHtml, 'utf-8');

      materialDefs.push({
        id: item.id,
        name: item.name,
        category: item.category,
        type: 'svg',
        content: `/materials/svg/${fileName}`,
        color: color,
      });

      console.log(`[Generate] ${item.iconName.padEnd(16)} -> ${fileName}`);
    } catch (err) {
      console.error(`[Generate] ${item.iconName}: ${err.message}`);
    }
  }

  // 生成 TypeScript 配置文件
  const tsContent = generateTSConfig(materialDefs);
  const tsPath = path.join(PORTAL_ROOT, 'src', 'config', 'materials.ts');
  fs.mkdirSync(path.dirname(tsPath), { recursive: true });
  fs.writeFileSync(tsPath, tsContent, 'utf-8');

  console.log(`\n[Generate] 完成！`);
  console.log(`   SVG 文件: ${materialDefs.length} 个 → public/materials/svg/`);
  console.log(`   配置文件: src/config/materials.ts`);
}

function generateTSConfig(defs) {
  const bgCount = BACKGROUNDS.length;
  const categoryEntries = Object.entries(CATEGORIES).map(([key, val]) => {
    const count = defs.filter(d => d.category === key).length;
    return `  { key: '${key}', label: '${val.label}', icon: '${val.icon}', order: ${val.order}, count: ${count} },`;
  }).join('\n');

  const materialEntries = defs.map(d =>
    `  { id: '${d.id}', name: '${d.name}', category: '${d.category}', type: 'svg', content: '${d.content}', color: '${d.color}' }`
  ).join(',\n');

  const bgEntries = BACKGROUNDS.map(b =>
    `  { id: '${b.id}', name: '${b.name}', category: 'background', type: 'color', content: '${b.content}' }`
  ).join(',\n');

  return `/**
 * 变变素材配置 — 自动生成，请勿手动修改
 * 生成命令：node scripts/generate-materials.mjs
 * 生成时间：${new Date().toISOString()}
 */
import type { MaterialItem, MaterialTab } from '@/types/material';

/** 素材分类定义 */
export const MATERIAL_TABS: MaterialTab[] = [
${categoryEntries}
  { key: 'background', label: '背景', icon: 'background', order: 7, count: ${bgCount} },
];

/** SVG/图片素材 */
export const SVG_MATERIALS: MaterialItem[] = [
${materialEntries}
];

/** 背景素材 */
export const BG_MATERIALS: MaterialItem[] = [
${bgEntries}
];

/** 所有素材合并（按分类 order 排序） */
export const ALL_MATERIALS: MaterialItem[] = [
  ...SVG_MATERIALS,
  ...BG_MATERIALS,
];

/** 按分类获取素材 */
export function getMaterialsByCategory(category: string): MaterialItem[] {
  if (category === 'all' || !category) return ALL_MATERIALS;
  return ALL_MATERIALS.filter(m => m.category === category);
}
`;
}

generate().catch(err => {
  console.error('生成失败:', err);
  process.exit(1);
});

/**
 * 变变素材配置 — 自动生成，请勿手动修改
 * 生成命令：node scripts/generate-materials.mjs
 * 生成时间：2026-07-19T05:03:10.718Z
 */
import type { MaterialItem, MaterialTab } from '@/types/material';

/** 素材分类定义 */
export const MATERIAL_TABS: MaterialTab[] = [
  { key: 'animal', label: '动物', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjhDNDIiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiAyLjY5bDUuNjYgNS42NmE4IDggMCAxIDEtMTEuMzEgMHoiLz48Y2lyY2xlIGN4PSI4LjUiIGN5PSIxMCIgcj0iMS41IiBmaWxsPSIjRkY4QzQyIiBzdHJva2U9Im5vbmUiLz48Y2lyY2xlIGN4PSIxNS41IiBjeT0iMTAiIHI9IjEuNSIgZmlsbD0iI0ZGOEM0MiIgc3Ryb2tlPSJub25lIi8+PC9zdmc+', order: 1, count: 7 },
  { key: 'nature', label: '自然', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM3RUQ5NTciIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik03IDE4Yy00LjUtMi01LTctNS03IDAgMCA1LTAuNSA3IDMiLz48cGF0aCBkPSJNMTIgMmMwIDAgMSA5IDkgOSIvPjxwYXRoIGQ9Ik0xNyAxOGM0LjUtMiA1LTcgNS03IDAgMC01LTAuNS03IDMiLz48cGF0aCBkPSJNMTIgMjJ2LTgiLz48L3N2Zz4=', order: 2, count: 14 },
  { key: 'food', label: '食物', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjZCOUQiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjEwIi8+PHBhdGggZD0iTTEyIDZ2Nmw0IDIiLz48L3N2Zz4=', order: 3, count: 12 },
  { key: 'transport', label: '交通', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM0RUNEQzQiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xNS41OSAxNC4zN2E2IDYgMCAwIDEtNS44NCA3LjM4di00LjhtNS44NC0yLjU4YTE0Ljk4IDE0Ljk4IDAgMCAwIDYuMTYtMTIuMTJBMTQuOTggMTQuOTggMCAwIDAgOS42MzEgOC40MW01Ljk2IDUuOTZhMTQuOTI2IDE0LjkyNiAwIDAgMS01Ljg0MSAyLjU4bS0uMTE5LTguNTRhNiA2IDAgMCAwLTcuMzgxIDUuODRoNC44bTIuNTgxLTUuODRhMTQuOTI3IDE0LjkyNyAwIDAgMC0yLjU4IDUuODRtMi42OTkgMi43Yy0uMTAzLjAyMS0uMjA3LjA0MS0uMzExLjA2YTE1LjA5IDE1LjA5IDAgMCAxLTIuNDQ4LTIuNDQ4IDE0LjkgMTQuOSAwIDAgMSAuMDYtLjMxMm0tMi4yNCAyLjM5YTQuNDkzIDQuNDkzIDAgMCAwLTEuNzU3IDQuMzA2IDQuNDkzIDQuNDkzIDAgMCAwIDQuMzA2LTEuNzU4TTE0LjUgMy41YTE0Ljk4IDE0Ljk4IDAgMCAxLTQuMzc2IDEyLjExNyIvPjwvc3ZnPg==', order: 4, count: 9 },
  { key: 'sticker', label: '贴纸', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNBNzhCRkEiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwb2x5Z29uIHBvaW50cz0iMTMgMiAzIDE0IDEyIDE0IDExIDIyIDIxIDEwIDEyIDEwIDEzIDIiLz48L3N2Zz4=', order: 5, count: 28 },
  { key: 'shape', label: '形状', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNGRjhDNDIiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSI3IiBoZWlnaHQ9IjciIHJ4PSIxIi8+PHJlY3QgeD0iMTQiIHk9IjMiIHdpZHRoPSI3IiBoZWlnaHQ9IjciIHJ4PSIxIi8+PHJlY3QgeD0iMyIgeT0iMTQiIHdpZHRoPSI3IiBoZWlnaHQ9IjciIHJ4PSIxIi8+PHJlY3QgeD0iMTQiIHk9IjE0IiB3aWR0aD0iNyIgaGVpZ2h0PSI3IiByeD0iMSIvPjwvc3ZnPg==', order: 6, count: 13 },
  { key: 'background', label: '背景', icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM0RUNEQzQiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxyZWN0IHg9IjMiIHk9IjMiIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgcng9IjIiIHJ5PSIyIi8+PGNpcmNsZSBjeD0iOC41IiBjeT0iOC41IiByPSIxLjUiLz48cGF0aCBkPSJtMjEgMTUtNS01TDUgMjEiLz48L3N2Zz4=', order: 7, count: 8 },
];

/** SVG/图片素材 */
export const SVG_MATERIALS: MaterialItem[] = [
  { id: 'animal-1', name: '小猫', category: 'animal', type: 'svg', content: '/materials/svg/material-animal-1.svg', color: '#FF8C42' },
  { id: 'animal-2', name: '小狗', category: 'animal', type: 'svg', content: '/materials/svg/material-animal-2.svg', color: '#FF8C42' },
  { id: 'animal-11', name: '小鱼', category: 'animal', type: 'svg', content: '/materials/svg/material-animal-11.svg', color: '#FF8C42' },
  { id: 'animal-12', name: '蝴蝶', category: 'animal', type: 'svg', content: '/materials/svg/material-animal-12.svg', color: '#FF8C42' },
  { id: 'animal-16', name: '毛毛虫', category: 'animal', type: 'svg', content: '/materials/svg/material-animal-16.svg', color: '#FF8C42' },
  { id: 'animal-17', name: '蚂蚁', category: 'animal', type: 'svg', content: '/materials/svg/material-animal-17.svg', color: '#FF8C42' },
  { id: 'animal-18', name: '马', category: 'animal', type: 'svg', content: '/materials/svg/material-animal-18.svg', color: '#FF8C42' },
  { id: 'nature-1', name: '太阳', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-1.svg', color: '#7ED957' },
  { id: 'nature-2', name: '月亮', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-2.svg', color: '#7ED957' },
  { id: 'nature-3', name: '星星', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-3.svg', color: '#7ED957' },
  { id: 'nature-4', name: '云朵', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-4.svg', color: '#7ED957' },
  { id: 'nature-5', name: '彩虹', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-5.svg', color: '#7ED957' },
  { id: 'nature-6', name: '花朵', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-6.svg', color: '#7ED957' },
  { id: 'nature-7', name: '大树', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-7.svg', color: '#7ED957' },
  { id: 'nature-8', name: '蘑菇', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-8.svg', color: '#7ED957' },
  { id: 'nature-9', name: '叶子', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-9.svg', color: '#7ED957' },
  { id: 'nature-10', name: '雪花', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-10.svg', color: '#7ED957' },
  { id: 'nature-11', name: '火焰', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-11.svg', color: '#7ED957' },
  { id: 'nature-12', name: '水滴', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-12.svg', color: '#7ED957' },
  { id: 'nature-13', name: '闪电', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-13.svg', color: '#7ED957' },
  { id: 'nature-14', name: '旋风', category: 'nature', type: 'svg', content: '/materials/svg/material-nature-14.svg', color: '#7ED957' },
  { id: 'food-1', name: '蛋糕', category: 'food', type: 'svg', content: '/materials/svg/material-food-1.svg', color: '#FF6B9D' },
  { id: 'food-2', name: '冰淇淋', category: 'food', type: 'svg', content: '/materials/svg/material-food-2.svg', color: '#FF6B9D' },
  { id: 'food-3', name: '棒棒糖', category: 'food', type: 'svg', content: '/materials/svg/material-food-3.svg', color: '#FF6B9D' },
  { id: 'food-4', name: '苹果', category: 'food', type: 'svg', content: '/materials/svg/material-food-4.svg', color: '#FF6B9D' },
  { id: 'food-6', name: '饼干', category: 'food', type: 'svg', content: '/materials/svg/material-food-6.svg', color: '#FF6B9D' },
  { id: 'food-7', name: '披萨', category: 'food', type: 'svg', content: '/materials/svg/material-food-7.svg', color: '#FF6B9D' },
  { id: 'food-9', name: '葡萄', category: 'food', type: 'svg', content: '/materials/svg/material-food-9.svg', color: '#FF6B9D' },
  { id: 'food-10', name: '柠檬', category: 'food', type: 'svg', content: '/materials/svg/material-food-10.svg', color: '#FF6B9D' },
  { id: 'food-11', name: '樱桃', category: 'food', type: 'svg', content: '/materials/svg/material-food-11.svg', color: '#FF6B9D' },
  { id: 'food-12', name: '咖啡', category: 'food', type: 'svg', content: '/materials/svg/material-food-12.svg', color: '#FF6B9D' },
  { id: 'food-13', name: '牛奶', category: 'food', type: 'svg', content: '/materials/svg/material-food-13.svg', color: '#FF6B9D' },
  { id: 'food-14', name: '鸡蛋', category: 'food', type: 'svg', content: '/materials/svg/material-food-14.svg', color: '#FF6B9D' },
  { id: 'trans-1', name: '火箭', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-1.svg', color: '#4ECDC4' },
  { id: 'trans-2', name: '飞机', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-2.svg', color: '#4ECDC4' },
  { id: 'trans-3', name: '汽车', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-3.svg', color: '#4ECDC4' },
  { id: 'trans-4', name: '火车', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-4.svg', color: '#4ECDC4' },
  { id: 'trans-5', name: '轮船', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-5.svg', color: '#4ECDC4' },
  { id: 'trans-7', name: '直升机', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-7.svg', color: '#4ECDC4' },
  { id: 'trans-8', name: '热气球', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-8.svg', color: '#4ECDC4' },
  { id: 'trans-9', name: '帆船', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-9.svg', color: '#4ECDC4' },
  { id: 'trans-11', name: '巴士', category: 'transport', type: 'svg', content: '/materials/svg/material-trans-11.svg', color: '#4ECDC4' },
  { id: 'sticker-1', name: '礼物', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-1.svg', color: '#A78BFA' },
  { id: 'sticker-2', name: '皇冠', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-2.svg', color: '#A78BFA' },
  { id: 'sticker-3', name: '气球', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-3.svg', color: '#A78BFA' },
  { id: 'sticker-4', name: '音符', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-4.svg', color: '#A78BFA' },
  { id: 'sticker-5', name: '星星魔法', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-5.svg', color: '#A78BFA' },
  { id: 'sticker-6', name: '奖杯', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-6.svg', color: '#A78BFA' },
  { id: 'sticker-7', name: '钻石', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-7.svg', color: '#A78BFA' },
  { id: 'sticker-8', name: '旗帜', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-8.svg', color: '#A78BFA' },
  { id: 'sticker-9', name: '星星', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-9.svg', color: '#A78BFA' },
  { id: 'sticker-10', name: '爱心', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-10.svg', color: '#A78BFA' },
  { id: 'sticker-11', name: '相机', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-11.svg', color: '#A78BFA' },
  { id: 'sticker-12', name: '书本', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-12.svg', color: '#A78BFA' },
  { id: 'sticker-13', name: '钥匙', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-13.svg', color: '#A78BFA' },
  { id: 'sticker-14', name: '放大镜', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-14.svg', color: '#A78BFA' },
  { id: 'sticker-15', name: '房屋', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-15.svg', color: '#A78BFA' },
  { id: 'sticker-16', name: '钟表', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-16.svg', color: '#A78BFA' },
  { id: 'sticker-17', name: '地球', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-17.svg', color: '#A78BFA' },
  { id: 'sticker-18', name: '王冠', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-18.svg', color: '#A78BFA' },
  { id: 'sticker-19', name: '魔法', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-19.svg', color: '#A78BFA' },
  { id: 'sticker-20', name: '笑脸', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-20.svg', color: '#A78BFA' },
  { id: 'sticker-21', name: '哭脸', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-21.svg', color: '#A78BFA' },
  { id: 'sticker-22', name: '惊讶', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-22.svg', color: '#A78BFA' },
  { id: 'sticker-23', name: '开心', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-23.svg', color: '#A78BFA' },
  { id: 'sticker-25', name: '眨眼', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-25.svg', color: '#A78BFA' },
  { id: 'sticker-27', name: '帅气', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-27.svg', color: '#A78BFA' },
  { id: 'sticker-28', name: '可爱', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-28.svg', color: '#A78BFA' },
  { id: 'sticker-29', name: '电话', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-29.svg', color: '#A78BFA' },
  { id: 'sticker-30', name: '邮件', category: 'sticker', type: 'svg', content: '/materials/svg/material-sticker-30.svg', color: '#A78BFA' },
  { id: 'shape-1', name: '圆形', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-1.svg', color: '#FF8C42' },
  { id: 'shape-2', name: '方形', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-2.svg', color: '#FF8C42' },
  { id: 'shape-3', name: '三角', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-3.svg', color: '#FF8C42' },
  { id: 'shape-4', name: '爱心', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-4.svg', color: '#FF8C42' },
  { id: 'shape-5', name: '星形', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-5.svg', color: '#FF8C42' },
  { id: 'shape-6', name: '菱形', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-6.svg', color: '#FF8C42' },
  { id: 'shape-7', name: '六边形', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-7.svg', color: '#FF8C42' },
  { id: 'shape-8', name: '五边形', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-8.svg', color: '#FF8C42' },
  { id: 'shape-9', name: '箭头上', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-9.svg', color: '#FF8C42' },
  { id: 'shape-10', name: '箭头下', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-10.svg', color: '#FF8C42' },
  { id: 'shape-11', name: '箭头左', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-11.svg', color: '#FF8C42' },
  { id: 'shape-12', name: '箭头右', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-12.svg', color: '#FF8C42' },
  { id: 'shape-14', name: '十字', category: 'shape', type: 'svg', content: '/materials/svg/material-shape-14.svg', color: '#FF8C42' }
];

/** 背景素材 */
export const BG_MATERIALS: MaterialItem[] = [
  { id: 'bg-1', name: '晴天', category: 'background', type: 'color', content: 'linear-gradient(135deg, #87CEEB 0%, #E0F7FA 100%)' },
  { id: 'bg-2', name: '日落', category: 'background', type: 'color', content: 'linear-gradient(135deg, #FF8C42 0%, #FFD93D 100%)' },
  { id: 'bg-3', name: '星空', category: 'background', type: 'color', content: 'linear-gradient(135deg, #2C3E50 0%, #4CA1AF 100%)' },
  { id: 'bg-4', name: '森林', category: 'background', type: 'color', content: 'linear-gradient(135deg, #7ED957 0%, #4ECDC4 100%)' },
  { id: 'bg-5', name: '粉色', category: 'background', type: 'color', content: 'linear-gradient(135deg, #FFB6C1 0%, #FFE4E1 100%)' },
  { id: 'bg-6', name: '紫色', category: 'background', type: 'color', content: 'linear-gradient(135deg, #DDA0DD 0%, #E8D5F5 100%)' },
  { id: 'bg-7', name: '暖白', category: 'background', type: 'color', content: '#FFF8F0' },
  { id: 'bg-8', name: '海洋', category: 'background', type: 'color', content: 'linear-gradient(135deg, #4ECDC4 0%, #44A08D 100%)' }
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

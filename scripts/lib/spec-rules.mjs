/**
 * specs/ 规约判定的单一实现（audit-specs.mjs 与 gen-specs-index.mjs 共用）
 *
 * 规范真源：~/AiWorkspace/20-私域资产/规格驱动开发SDD-SOP.md
 *   §2 文件命名 / §3 状态字段 / §4 requirements 章节
 *
 * ── 为什么抽出来 ────────────────────────────────────────────────────────
 * specs/README.md 的「R8 章节欠账」必须与 `npm run check:specs` 同源。
 * 如果索引脚本另写一套「边界与反例 / 变更日志」的判定，两边迟早漂移：
 * 门禁说 6 份欠账、索引说 5 份，读的人就不知道该信谁。
 * 因此判定逻辑只留一份，两个脚本 import 同一模块。
 *
 * 约束：本文件只做纯函数与常量（`walkAll` 仅做目录遍历，不读写文件内容），
 * 不打印、不退出进程，便于被任意脚本组合（也便于将来单测）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 核心产物文件名（SOP §2.1） */
export const CORE = new Set(['requirements.md', 'design.md', 'tasks.md']);

/** 产物类型白名单（SOP §2.1）。按「整串等于类型」或「类型 + -」匹配 */
export const TYPES = new Set([
  'api-design', 'page-spec', 'tech-design', 'review', 'progress',
  'glossary', 'index', 'handoff', 'guide', 'inventory', 'proposal',
  'adr', 'decision',
]);

// 非 md 的产物：本仓大量 feature 是原型驱动，只有 prototype.html 而无任何 md
// （pipeline-form-preview / popconfirm-width / sider-submenu-spacing 即此形态）。
export const PRODUCT_NON_MD = new Set(['prototype.html']);

/** 状态封闭枚举（SOP §3） */
export const STATUS = new Set([
  '草稿', '需求编写中', '方案设计中', '待评审',
  '已评审确认', '实施中', '已实现', '已归档',
]);

export const STATUS_RE = /^>\s*状态：\s*(\S+?)\s*(?:｜|\|)/;
export const STATUS_SCAN_LINES = 12;

// requirements.md 的「可验判据」锚点：按语义匹配，不认死标题（SOP §4 / §4.1）
export const VERIFIABLE_RE = /验收|判据|EARS|V\d|验证标准/;

// 「边界与反例」「变更日志」只做 notice（存量 5/8、4/8，硬门会误杀语义齐全的存量）
export const SOFT_SECTION = {
  边界与反例: /边界|反例|非目标|不做/,
  变更日志: /变更日志|changelog/i,
};

/** 文件名是否符合 §2.1 白名单 */
export function nameCompliant(name) {
  if (CORE.has(name)) return true;
  const base = name.replace(/\.md$/, '');
  // handoff 允许 P0-/P1-/HANDOFF 前缀，归一成 handoff
  const norm = base.replace(/^(P0-|P1-|HANDOFF-?)/i, 'handoff-').replace(/-$/, '');
  // 类型名本身可能带连字符（api-design / page-spec / tech-design），
  // 因此要按「整串等于类型」或「类型 + -」匹配，不能按第一段切分。
  for (const t of TYPES) {
    if (norm === t || norm.startsWith(`${t}-`)) return true;
  }
  return false;
}

/** 目录内是否存在「算得上产物」的文件：命名合规的 .md，或原型白名单 */
export function isProductFile(name) {
  return PRODUCT_NON_MD.has(name) || (name.endsWith('.md') && nameCompliant(name));
}

/**
 * 缺 requirements.md 的 feature 属于哪种形态。
 * 口径见 30-任务产物/2026-11-06-web_system-specs治理/04-R6欠账分类-*.md
 */
export function shapeOf(allFiles) {
  const names = allFiles.map((f) => f.split(/[\\/]/).pop());
  const has = (re) => names.some((n) => re.test(n));
  if (names.includes('design.md')) return 'design';
  const hasApi = has(/^api-design/);
  const hasPage = has(/^page-spec/);
  const hasTd = has(/^tech-design/);
  if (hasApi && !hasPage && !hasTd) return 'api';
  if (hasPage && !hasApi && !hasTd) return 'page';
  if (hasTd) return 'techDesign';
  if (names.includes('prototype.html')) return 'proto';
  if (has(/^inventory-/)) return 'inventory';
  return 'other';
}

export const SHAPE_LABEL = {
  design: '有 design',
  api: '纯 api-design',
  page: '纯 page-spec',
  techDesign: '有 tech-design',
  proto: '纯原型',
  inventory: '纯 inventory',
  other: '其它',
};

/** 目录内所有文件（含非 md）—— 空目录判定与产物判定共用 */
export function walkAll(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkAll(p, acc);
    else acc.push(p);
  }
  return acc;
}

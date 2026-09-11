#!/usr/bin/env node
/**
 * 迁移：模型单价 `model_pricing` → 字典 `llm_models` 的价格字段
 * （specs/llm-models-unify/design.md §4.4）
 *
 * 用法：
 *   node scripts/db/migrate-model-pricing-to-dict.mjs            # dry-run：只打印将发生什么
 *   node scripts/db/migrate-model-pricing-to-dict.mjs --apply    # 真正落库
 *
 * 行为：
 *   1. 读 `model_pricing` 全表，按 `model` 匹配 `dict_items(type_code='llm_models', value=model)`；
 *   2. 命中且字典项**尚无价格** → 把 input_price_per1k / output_price_per1k / currency 合并进 attrs；
 *   3. 命中但字典项**已有价格** → 跳过（人工在页面维护过的值优先），并把差异打出来供核对；
 *   4. 未命中（字典里没有这个模型）→ 记入「孤儿单价」，**不自动建字典项**
 *      —— 一个模型"是否可用"是业务决策，不该由脚本臆断（design §7 待确认 4 的结论）；
 *   5. 幂等：重复执行只会得到「已存在跳过」。
 *
 * 注意：只写 dict_items.attrs，不动 model_pricing（该表保留留痕，另提删除迁移）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/** 极简 .env 解析（与 scripts/db/grant-super-admin.mjs 保持一致，不引额外依赖） */
function loadEnvFile(file) {
  if (!existsSync(file)) return {};
  const result = {};
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const env = {
  ...loadEnvFile(path.join(ROOT, '.env')),
  ...loadEnvFile(path.join(ROOT, 'servers/system-service/.env')),
};

const require = createRequire(path.join(ROOT, 'servers/system-service/package.json'));
let mysql;
try {
  mysql = require('mysql2/promise');
} catch {
  console.error('未找到 mysql2，请先执行：pnpm --filter @web-system/system-service install');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const DICT_CODE = 'llm_models';
const PRICE_KEYS = ['input_price_per1k', 'output_price_per1k'];

/** MySQL JSON 列在不同驱动配置下可能是字符串或对象 */
function parseAttrs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 价格是否"已配置"（null/undefined/'' 视为未配置；0 视为已配置 —— 0 是合法价格） */
function hasPrice(attrs) {
  return PRICE_KEYS.some((k) => attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== '');
}

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));

async function main() {
  const conn = await mysql.createConnection({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USERNAME || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_DATABASE || 'web_system',
  });

  try {
    const [pricings] = await conn.query(
      'SELECT id, provider, model, input_price_per1k, output_price_per1k, currency FROM model_pricing ORDER BY model',
    );
    const [items] = await conn.query(
      'SELECT id, value, attrs FROM dict_items WHERE type_code = ? AND deleted_at IS NULL',
      [DICT_CODE],
    );

    console.log(`\n[迁移] model_pricing：${pricings.length} 行；dict_items.${DICT_CODE}：${items.length} 项`);
    if (!pricings.length) {
      console.log('[迁移] 没有可迁移的单价记录，结束。');
      return;
    }

    const itemByValue = new Map(items.map((i) => [i.value, i]));

    const migrated = [];
    const skipped = [];
    const orphans = [];

    for (const p of pricings) {
      const item = itemByValue.get(p.model);
      if (!item) {
        orphans.push(p);
        continue;
      }
      const attrs = parseAttrs(item.attrs);
      if (hasPrice(attrs)) {
        skipped.push({ p, attrs });
        continue;
      }
      const next = {
        ...attrs,
        input_price_per1k: num(p.input_price_per1k),
        output_price_per1k: num(p.output_price_per1k),
        currency: p.currency || 'CNY',
      };
      migrated.push({ p, next });

      if (APPLY) {
        await conn.query('UPDATE dict_items SET attrs = ?, updated_at = NOW(6) WHERE id = ?', [
          JSON.stringify(next),
          item.id,
        ]);
      }
    }

    // ── 结果明细 ──
    console.log(`\n✔ 待迁移（字典项尚无价格）：${migrated.length}`);
    for (const m of migrated) {
      console.log(
        `   - ${m.p.model}：${num(m.p.input_price_per1k)}/${num(m.p.output_price_per1k)} ${m.p.currency || 'CNY'}` +
          `（提供方 ${m.p.provider}）`,
      );
    }

    console.log(`\n⏭ 跳过（字典项已有价格，人工维护优先）：${skipped.length}`);
    for (const s of skipped) {
      console.log(
        `   - ${s.p.model}：字典 = ${s.attrs.input_price_per1k ?? '—'}/${s.attrs.output_price_per1k ?? '—'} ` +
          `${s.attrs.currency ?? ''}｜旧表 = ${num(s.p.input_price_per1k)}/${num(s.p.output_price_per1k)} ${s.p.currency || 'CNY'}`,
      );
    }

    console.log(`\n⚠ 孤儿单价（字典里没有该模型，需人工决策：补字典项 or 丢弃）：${orphans.length}`);
    for (const o of orphans) {
      console.log(
        `   - ${o.provider}/${o.model}：${num(o.input_price_per1k)}/${num(o.output_price_per1k)} ${o.currency || 'CNY'}`,
      );
    }

    if (!APPLY) {
      console.log('\n[dry-run] 未写库。确认无误后加 --apply 执行。');
    } else {
      console.log(`\n[applied] 已写入 ${migrated.length} 条字典项价格。`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('执行失败：', err.message);
  process.exit(1);
});

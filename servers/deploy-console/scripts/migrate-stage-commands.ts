/**
 * 迁移：deploy_modules.buildCmd + deploy_module_hooks → deploy_module_stage_commands
 *
 * 统一历史两套互斥机制为单一真相源（specs/release-platform/design.md 决策 1）。
 *
 * 用法：
 *   npx ts-node scripts/migrate-stage-commands.ts           # dry-run：建表 + 输出计划与冲突，不写库
 *   npx ts-node scripts/migrate-stage-commands.ts --apply   # 实际写入
 *
 * 行为：
 *   0. 初始化 DataSource（synchronize 建表，结构以 entity 为权威）
 *   1. buildCmd → stage_commands(build)
 *   2. deploy_module_hooks（enabled）→ stage_commands(对应阶段)
 *   3. 冲突（同键多来源，或目标已有不同内容）→ 只列清单，绝不静默覆盖
 *   4. enabled 模块缺 build 命令 → 按 DEFAULT_BUILD_TEMPLATE 填充
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import {
  DeployModuleStageCommandEntity,
  CONFIGURABLE_STAGES,
  DEFAULT_BUILD_TEMPLATE,
} from '../src/entities/deploy-module-stage-command.entity';

dotenv.config();

const DRY_RUN = !process.argv.includes('--apply');

interface PlanItem {
  moduleKey: string;
  stage: string;
  command: string;
  sources: string[];
}

async function main() {
  const ds = new DataSource({
    type: 'mysql',
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    username: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DB,
    entities: [DeployModuleStageCommandEntity],
    synchronize: true, // 建表：结构以 entity 为权威，无需重启控制台
    charset: 'utf8mb4',
  });

  await ds.initialize();
  console.log('✅ 表 deploy_module_stage_commands 已就绪（结构由 entity synchronize 保证）');

  try {
    const repo = ds.getRepository(DeployModuleStageCommandEntity);

    const modules: Array<{ key: string; type: string; buildCmd: string | null; enabled: number }> =
      await ds.query('SELECT `key`, type, build_cmd AS buildCmd, enabled FROM deploy_modules');
    const hooks: Array<{ moduleKey: string; stage: string; script: string; enabled: number }> =
      await ds.query('SELECT module_key AS moduleKey, stage, script, enabled FROM deploy_module_hooks');
    const existing = await repo.find();

    const existingMap = new Map<string, string>();
    for (const e of existing) existingMap.set(`${e.moduleKey}:${e.stage}`, e.command);

    // 计划来源仅含 buildCmd 与 hook（existing 是迁移结果，不作为来源）
    const plan = new Map<string, PlanItem>();
    const push = (moduleKey: string, stage: string, command: string, source: string) => {
      if (!command?.trim()) return;
      if (!(CONFIGURABLE_STAGES as readonly string[]).includes(stage)) return; // version/pointer 不迁移
      const k = `${moduleKey}:${stage}`;
      const cur = plan.get(k);
      if (!cur) plan.set(k, { moduleKey, stage, command, sources: [source] });
      else cur.sources.push(source);
    };

    for (const m of modules) if (m.buildCmd) push(m.key, 'build', m.buildCmd, 'buildCmd');
    for (const h of hooks) if (h.enabled) push(h.moduleKey, h.stage, h.script, 'hook');

    // 冲突：同键多来源，或目标已存在且内容不同
    const conflicts: Array<{ k: string; reason: string }> = [];
    for (const [k, p] of plan) {
      if (p.sources.length > 1) {
        conflicts.push({ k, reason: `多来源 ${p.sources.join(',')}` });
      } else {
        const prev = existingMap.get(k);
        if (prev !== undefined && prev.trim() !== p.command.trim()) {
          conflicts.push({ k, reason: '目标已存在且内容不同' });
        }
      }
    }
    const conflictKeys = new Set(conflicts.map((c) => c.k));
    const writes = [...plan.values()].filter((p) => !conflictKeys.has(`${p.moduleKey}:${p.stage}`));

    // 默认模板：enabled 模块缺 build 命令
    const defaults: Array<{ moduleKey: string; command: string }> = [];
    for (const m of modules) {
      if (!m.enabled) continue;
      const tpl = DEFAULT_BUILD_TEMPLATE[m.type];
      if (!tpl) continue;
      const k = `${m.key}:build`;
      if (!plan.has(k) && !existingMap.has(k)) defaults.push({ moduleKey: m.key, command: tpl });
    }

    console.log(`\n模块 ${modules.length} 个，hook ${hooks.length} 条，目标表已有 ${existing.length} 条`);
    if (conflicts.length) {
      console.log('\n⚠️  以下条目需人工确认（本次不写入）：');
      for (const c of conflicts) console.log(`  - ${c.k}  (${c.reason})`);
    }
    if (defaults.length) {
      console.log('\n将按类型填充默认 build 命令：');
      for (const d of defaults) console.log(`  - ${d.moduleKey}: ${d.command}`);
    }
    console.log(`\n计划写入 ${writes.length} 条（dry-run=${DRY_RUN}）`);

    if (DRY_RUN) {
      console.log('（dry-run 未写库；确认无误后加 --apply 执行）');
      return;
    }

    for (const w of writes) {
      await repo.upsert(
        repo.create({ moduleKey: w.moduleKey, stage: w.stage, command: w.command, enabled: true }),
        { conflictPaths: ['moduleKey', 'stage'] },
      );
    }
    for (const d of defaults) {
      await repo.upsert(
        repo.create({ moduleKey: d.moduleKey, stage: 'build', command: d.command, enabled: true }),
        { conflictPaths: ['moduleKey', 'stage'] },
      );
    }
    console.log(`✅ 迁移完成：写入 ${writes.length} 条，默认模板 ${defaults.length} 条`);
  } finally {
    await ds.destroy();
  }
}

main().catch((e) => {
  console.error('❌ 迁移失败：', e.message);
  process.exit(1);
});

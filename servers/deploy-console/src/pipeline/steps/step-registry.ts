import { DeployPipelineEntity } from '../../entities/deploy-pipeline.entity';
import { BuiltinStepDef } from './step.types';
import { CheckExecutor } from './check.executor';
import { PullExecutor } from './pull.executor';
import { UploadExecutor } from './upload.executor';
import { ApplyExecutor } from './apply.executor';
import { VersionExecutor } from './version.executor';
import { PointerExecutor } from './pointer.executor';
import { CleanupExecutor } from './cleanup.executor';

/** 内置步骤注册表的 DI token（engine 注入聚合后的 Record） */
export const PIPELINE_BUILTIN_STEPS = 'PIPELINE_BUILTIN_STEPS';

/**
 * 内置步骤执行体集合。
 *
 * ⚠️ **2026-09-21 移除 `restart` / `verify`**（用户决定，见
 * `specs/pipeline-restart-verify-as-action/design.md`）：这两个能力原先由平台代码实现，
 * 但模板里根本没有对应节点（孤儿），重启/探活实际发生在控制台「部署」接口里。
 * 现按「发布动作一律脚本」的口径下沉为**发布流水线里的 DB action**，代码侧不再承担。
 */
export interface BuiltinExecutors {
  check: CheckExecutor;
  pull: PullExecutor;
  upload: UploadExecutor;
  /** 后台模块部署生效（版本目录 → dist + 重启 + 切指针），方案 A 2026-09-17 */
  apply: ApplyExecutor;
  version: VersionExecutor;
  pointer: PointerExecutor;
  cleanup: CleanupExecutor;
}

/** 复用磁盘产物的守卫（跳过程码获取/构建/投递/重启） */
const skipReuseArtifact = (p: DeployPipelineEntity): boolean => !!p.reuseArtifact;

/**
 * 组装内置步骤注册表（配置化声明）。
 *
 * 每个步骤 = category（特性分类）+ commandMode（命令协作）+ skip（守卫）+ run（执行体）。
 * 新增/裁剪步骤只改这里或模板 steps；engine 不感知任何步骤实现细节。
 */
export function buildBuiltinSteps(ex: BuiltinExecutors): Record<string, BuiltinStepDef> {
  return {
    check: {
      category: 'semantic',
      commandMode: 'base', // 安全基线恒内置执行，命令作为附加校验
      run: (ctx) => ex.check.run(ctx),
    },
    pull: {
      category: 'code',
      commandMode: 'override',
      skip: skipReuseArtifact,
      run: (ctx) => ex.pull.run(ctx),
      // 命令驱动（DB 锁定脚本拉码）时，依赖同步与预构建仍由平台收尾
      afterRun: (ctx) => ex.pull.afterSync(ctx),
    },
    build: {
      category: 'build',
      commandMode: 'required', // 必须命令驱动，未配置 fail-fast
      skip: skipReuseArtifact,
    },
    upload: {
      category: 'deploy',
      commandMode: 'override',
      skip: (p) => skipReuseArtifact(p) || p.moduleType === 'backend',
      run: (ctx) => ex.upload.run(ctx),
    },
    apply: {
      category: 'deploy',
      // 纯内置（与其他 service action 的 none 语义一致）：流水线不该用命令覆盖「如何生效」，
      // 否则又会长出五花八门的重启姿势。
      commandMode: 'none',
      // 只对后台模块有意义：前端类是「切指针即生效」（pointer 步骤），没有 dist 要落地；
      // 复用产物（reuseArtifact）时不重新生效。
      skip: (p) => skipReuseArtifact(p) || p.moduleType !== 'backend',
      run: (ctx) => ex.apply.run(ctx),
    },
    version: {
      category: 'semantic',
      commandMode: 'none', // 写版本表：发布语义真相源
      run: (ctx) => ex.version.run(ctx),
    },
    pointer: {
      category: 'semantic',
      commandMode: 'none', // 切指针/灰度规则：发布语义真相源
      skip: (p) => p.moduleType === 'backend',
      run: (ctx) => ex.pointer.run(ctx),
    },
    cleanup: {
      category: 'cleanup',
      commandMode: 'override',
      run: (ctx) => ex.cleanup.run(ctx),
    },
  };
}

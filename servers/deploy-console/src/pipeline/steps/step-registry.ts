import { DeployPipelineEntity } from '../../entities/deploy-pipeline.entity';
import { BuiltinStepDef } from './step.types';
import { CheckExecutor } from './check.executor';
import { PullExecutor } from './pull.executor';
import { UploadExecutor } from './upload.executor';
import { RestartExecutor } from './restart.executor';
import { VersionExecutor } from './version.executor';
import { PointerExecutor } from './pointer.executor';
import { VerifyExecutor } from './verify.executor';
import { CleanupExecutor } from './cleanup.executor';

/** 内置步骤注册表的 DI token（engine 注入聚合后的 Record） */
export const PIPELINE_BUILTIN_STEPS = 'PIPELINE_BUILTIN_STEPS';

export interface BuiltinExecutors {
  check: CheckExecutor;
  pull: PullExecutor;
  upload: UploadExecutor;
  restart: RestartExecutor;
  version: VersionExecutor;
  pointer: PointerExecutor;
  verify: VerifyExecutor;
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
    restart: {
      category: 'deploy',
      commandMode: 'override',
      skip: (p) => skipReuseArtifact(p) || p.moduleType !== 'backend',
      run: (ctx) => ex.restart.run(ctx),
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
    verify: {
      category: 'probe',
      commandMode: 'override',
      skip: (p) => !!p.skipVerify, // 快线：跳过探活与失败自动回滚
      run: (ctx) => ex.verify.run(ctx),
    },
    cleanup: {
      category: 'cleanup',
      commandMode: 'override',
      run: (ctx) => ex.cleanup.run(ctx),
    },
  };
}

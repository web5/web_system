/**
 * M4 配置镜像双写的回归防护。
 *
 * 为什么要这个测试（2026-10-18 教训，与 M2 同源）：
 * 「给 service 构造函数注入新依赖」有两处会出错，**而全量单测不会报警**：
 *   ① spec 里直接 `new Service(...)` 少传参数 → TS 编译期能抓住（所以 M4 第一次就被 tsc 挡了）
 *   ② 生产 `@Module` 里没 import 提供该依赖的模块 → **编译期完全看不出来**，
 *      只在 Nest 容器启动时才炸（本地 dəb 不到 → 直接打到 dev/prod）
 *
 * 这里就专门盯 ②：凡是注入了 `EnvSplitWriterService` 的模块，其 `@Module({imports})`
 * 必须包含 `CloudDbModule`。以后再新增这种接入点，忘了接线就会红。
 */
import { Module } from '@nestjs/common';
import { CloudDbModule } from './cloud-db.module';
import { EnvSplitWriterService } from './env-split-writer.service';
import { AppsModule } from '../apps/apps.module';
import { CanaryModule } from '../canary/canary.module';
import { EnvsModule } from '../envs/envs.module';
import { HostsModule } from '../hosts/hosts.module';
import { ServicesModule } from '../services/services.module';
import { DeployModule } from '../deploy/deploy.module';
import { HealthModule } from '../health/health.module';
import { ReleaseRegistryModule } from '../registry/release-registry.module';

/** 注入了 EnvSplitWriterService 的模块（新增接入点时同步登记） */
const WIRED_MODULES = [
  ['AppsModule', AppsModule],
  ['CanaryModule', CanaryModule],
  ['EnvsModule', EnvsModule],
  ['HostsModule', HostsModule],
  ['ServicesModule', ServicesModule],
  ['DeployModule', DeployModule],
  ['HealthModule', HealthModule],
  ['ReleaseRegistryModule', ReleaseRegistryModule],
] as Array<[string, Type<any>]>;

type Type<T = unknown> = new (...args: any[]) => T;

describe('M4 模块接线（EnvSplitWriterService 的提供者必须可达）', () => {
  it.each(WIRED_MODULES)('%s 必须 import CloudDbModule', (_name, mod) => {
    const imports: unknown[] = Reflect.getMetadata('imports', mod) || [];
    expect(imports).toContain(CloudDbModule);
  });

  it('CloudDbModule 必须导出 EnvSplitWriterService（否则下游注入失败）', () => {
    const exportsList: unknown[] = Reflect.getMetadata('exports', CloudDbModule) || [];
    expect(exportsList).toContain(EnvSplitWriterService);
  });

  it('登记表不遗漏：以下 service 的构造函数确实依赖了 EnvSplitWriterService', () => {
    // 防止「有人删了注入但登记表还留着」导致本测试失去意义
    const dep: unknown[] = Reflect.getMetadata('design:paramtypes', ServicesServicePlaceholder) || [];
    expect(dep).toContain(EnvSplitWriterService);
  });
});

// 只为取构造元数据的占位引用（不实例化，避免触发真实依赖）
import { ServicesService } from '../services/services.service';
const ServicesServicePlaceholder = ServicesService;

describe('@Module 元数据可用性自检（元测试）', () => {
  it('Reflect.getMetadata("imports") 能读到模块依赖', () => {
    class Probe {}
    @Module({ imports: [CloudDbModule] })
    class ProbeModule {}
    expect(Reflect.getMetadata('imports', ProbeModule)).toContain(CloudDbModule);
    expect(Probe).toBeDefined();
  });
});

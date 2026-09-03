import { Module } from '@nestjs/common';
import { ShellModule } from '../shell/shell.module';
import { ModuleRegistryModule } from '../module-registry/module-registry.module';
import { ReleaseGitService } from './release-git.service';
import { BranchController } from './release-git.controller';

/**
 * 发布目录 git 工作区工具模块（pull 内置步骤的执行体）。
 * 与 tool-catalog `code` 分类的 service 工具对应，可被 pipeline 等模块复用。
 */
@Module({
  imports: [ShellModule, ModuleRegistryModule],
  controllers: [BranchController],
  providers: [ReleaseGitService],
  exports: [ReleaseGitService],
})
export class ReleaseGitModule {}

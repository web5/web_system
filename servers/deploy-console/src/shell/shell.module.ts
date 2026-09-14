import { Module } from '@nestjs/common';
import { CommandService } from './command.service';
import { SpawnShellRunner, SHELL_RUNNER } from './shell-runner';

/**
 * 命令执行工具模块（同步 exec + bin 路径 + PATH 补齐 + shell 执行通道）。
 * git 拉取 / pm2 查询 / 远程投递 / 依赖安装等平台执行体共用。
 *
 * `SHELL_RUNNER`：流水线节点脚本的执行通道，抽成可注入接口是为了让
 * 「节点执行 / 审批挂起恢复」可单测（否则引擎直接 spawn，无法 fake）。
 */
@Module({
  providers: [CommandService, SpawnShellRunner, { provide: SHELL_RUNNER, useExisting: SpawnShellRunner }],
  exports: [CommandService, SHELL_RUNNER],
})
export class ShellModule {}

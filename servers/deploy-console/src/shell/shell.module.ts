import { Module } from '@nestjs/common';
import { CommandService } from './command.service';

/**
 * 命令执行工具模块（同步 exec + bin 路径 + PATH 补齐）。
 * git 拉取 / pm2 查询 / 远程投递 / 依赖安装等平台执行体共用。
 */
@Module({
  providers: [CommandService],
  exports: [CommandService],
})
export class ShellModule {}

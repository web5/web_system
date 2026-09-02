import { Module } from '@nestjs/common';
import { ProbeModule } from '../probe/probe.module';
import { ShellModule } from '../shell/shell.module';
import { Pm2ProbeService } from './pm2-probe.service';

/**
 * pm2 进程探活工具模块（restart/verify/回滚后探活的执行体）。
 * 与 tool-catalog `probe` 分类的 service 工具对应，可被 pipeline 等模块复用。
 */
@Module({
  imports: [ProbeModule, ShellModule],
  providers: [Pm2ProbeService],
  exports: [Pm2ProbeService],
})
export class Pm2Module {}

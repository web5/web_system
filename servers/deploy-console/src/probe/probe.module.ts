import { Module } from '@nestjs/common';
import { HttpProbeService } from './http-probe.service';

/**
 * HTTP 探活工具模块（verify 内置步骤 / 后端健康探活的执行体）。
 * 与 tool-catalog `probe` 分类的 service 工具对应，可被 pipeline 等模块复用。
 */
@Module({
  providers: [HttpProbeService],
  exports: [HttpProbeService],
})
export class ProbeModule {}

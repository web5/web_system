import { Module } from '@nestjs/common';
import { ShellModule } from '../shell/shell.module';
import { RemoteDeliveryService } from './remote-delivery.service';

/**
 * 远程投递工具模块（upload 内置步骤 remote 分支的执行体）。
 * 与 tool-catalog `deploy` 分类的 service 工具对应，可被 pipeline 等模块复用。
 */
@Module({
  imports: [ShellModule],
  providers: [RemoteDeliveryService],
  exports: [RemoteDeliveryService],
})
export class RemoteDeliveryModule {}

import { Module } from '@nestjs/common';
import { ShellModule } from '../shell/shell.module';
import { HostsModule } from '../hosts/hosts.module';
import { ServerModule } from '../server/server.module';
import { RemoteDeliveryService } from './remote-delivery.service';
import { SshExecService } from './ssh-exec.service';
import { RemoteArtifactCleanupService } from './remote-artifact-cleanup.service';

/**
 * 远程投递工具模块（upload 内置步骤 remote 分支的执行体）。
 * 与 tool-catalog `deploy` 分类的 service 工具对应，可被 pipeline 等模块复用。
 */
@Module({
  imports: [ShellModule, HostsModule, ServerModule],
  providers: [RemoteDeliveryService, SshExecService, RemoteArtifactCleanupService],
  exports: [RemoteDeliveryService, SshExecService, RemoteArtifactCleanupService],
})
export class RemoteDeliveryModule {}

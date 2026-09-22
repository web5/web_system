import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { InternalGuard } from '../auth/internal.guard';
import { StorageService } from './storage.service';

/**
 * 存储路径内部接口（服务间调用，`x-internal-key: INTERNAL_API_KEY`）。
 *
 * 为什么要有：上传根目录是**平台级配置**，除了 system-service 自己，
 * 运维排查、其它服务与「当前生效 / 待生效」对比都需要一个稳定的读取口，
 * 而不是各自去连 system 库直读 `system_configs`（那会把配置表变成事实上的公共 API）。
 *
 * ⚠️ 返回的是**权威配置值**，不是某进程的内存值：
 * 「当前生效值」以 upload-service 的同名接口（它启动时采纳的内存值）为准，
 * 两者在「已保存未重启」期间本就不同 —— 这正是 design §1.2 要求页面展示双值的原因。
 */
@ApiTags('存储（内部）')
@Controller('internal/storage')
@Public()
@UseGuards(InternalGuard)
export class InternalStorageController {
  constructor(private readonly storage: StorageService) {}

  @Get('path')
  @ApiOperation({ summary: '读取权威上传根目录（含来源）' })
  async getPath() {
    const configured = await this.storage.resolveConfiguredUploadDir();
    return {
      code: 0,
      data: {
        path: configured.path,
        source: configured.source,
        browseEnabled: await this.storage.isBrowseEnabled(),
      },
    };
  }
}

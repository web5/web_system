import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { InternalGuard } from '../auth/internal.guard';
import { StorageService, STORAGE_TEMP_DIR_KEY, STORAGE_UPLOAD_DIR_KEY } from './storage.service';

/**
 * 内部接口可查询的存储配置键（**白名单**）。
 *
 * 为什么必须白名单：`system_configs` 里还有其它平台配置（审批环境、各类开关等），
 * 若 `?key=` 能查任意键，本接口就等价于「把配置表整体暴露成内部 API」——
 * 那正是它要避免的事（见类注释：不让各服务直连 system 库读配置表）。
 */
export const INTERNAL_STORAGE_KEYS: readonly string[] = [
  STORAGE_UPLOAD_DIR_KEY,
  STORAGE_TEMP_DIR_KEY,
] as const;

/**
 * 存储路径内部接口（服务间调用，`x-internal-key: INTERNAL_API_KEY`）。
 *
 * 为什么要有：存储目录是**平台级配置**，除了 system-service 自己，
 * 运维排查、其它服务与「当前生效 / 待生效」对比都需要一个稳定的读取口，
 * 而不是各自去连 system 库直读 `system_configs`（那会把配置表变成事实上的公共 API）。
 *
 * ⚠️ 返回的是**权威配置值**，不是某进程的内存值：
 * 「当前生效值」以消费服务自己的同名接口（它启动时采纳的内存值）为准，
 * 两者在「已保存未重启」期间本就不同 —— 这正是 design §1.2 要求页面展示双值的原因。
 *
 * ⚠️ `storage.temp_dir` **未配时返回派生默认值**（`<上传根目录的同级>/temp-images`），
 * `source='default'`。消费侧在集群形态下自行决定「default 能不能接受」：
 * 上传根目录是必需的（没人配过就该拒绝启动），临时图目录是派生的（允许用默认值）。
 */
@ApiTags('存储（内部）')
@Controller('internal/storage')
@Public()
@UseGuards(InternalGuard)
export class InternalStorageController {
  constructor(private readonly storage: StorageService) {}

  @Get('path')
  @ApiOperation({ summary: '读取权威存储目录（含来源）；?key= 指定键，缺省为上传根目录' })
  async getPath(@Query('key') key?: string) {
    const requested = key?.trim() || STORAGE_UPLOAD_DIR_KEY;
    if (!INTERNAL_STORAGE_KEYS.includes(requested)) {
      throw new BadRequestException({
        code: 'STORAGE_KEY_UNSUPPORTED',
        message: `不支持的存储配置键：${requested}（可用：${INTERNAL_STORAGE_KEYS.join('、')}）`,
      });
    }
    const configured =
      requested === STORAGE_TEMP_DIR_KEY
        ? await this.storage.resolveConfiguredTempDir()
        : await this.storage.resolveConfiguredUploadDir();
    return {
      code: 0,
      data: {
        key: requested,
        path: configured.path,
        source: configured.source,
        browseEnabled: await this.storage.isBrowseEnabled(),
      },
    };
  }
}

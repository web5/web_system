import { IsString, Length } from 'class-validator';

/**
 * 存储目录入参（保存 / 校验共用）。
 *
 * 长度上限 512：足够 Windows 长路径与 UNC 共享，同时挡住把超长字符串塞进配置表。
 * 具体合法性（是否越界、是否可写）由 `StorageService.checkStorageDir` 判定 ——
 * 那是唯一懂得「允许根」的地方，DTO 只做形态校验。
 */
export class StorageDirDto {
  @IsString()
  @Length(1, 512, { message: 'uploadDir 长度需在 1~512 之间' })
  uploadDir!: string;
}

/** 目录浏览入参（query） */
export class BrowseQueryDto {
  /** 目标绝对路径；缺省为第一个允许根（当前用户家目录） */
  @IsString()
  path?: string;
}

import { IsObject } from 'class-validator';

/**
 * 批量更新系统设置的 DTO
 * 只接受扁平的 key → string 映射，禁用 `Record<string, string>` 裸类型
 */
export class UpdateSettingsDto {
  /**
   * 任意 key-value 对，value 必须为 string
   * 非 string 值（嵌套对象、数组等）将被 ValidationPipe 拒绝
   */
  [key: string]: string | undefined;
}

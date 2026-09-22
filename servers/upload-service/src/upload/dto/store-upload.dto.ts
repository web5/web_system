import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { UploadService } from '../upload.service';

/**
 * 内部 store 入参（服务间调用：`POST /internal/uploads/store`）。
 *
 * 两种传法（同一路由，multer 对非 multipart 请求直接放行）：
 * - `multipart/form-data`：字段 `file`（二进制）+ `category`（+ 可选 `filename`/`userId`）；
 * - `application/json`：`{ category, filename, dataBase64 }`。
 *
 * `category` 用 `@IsIn` 限定在 CATEGORIES 之内 —— 它是**路径段**，
 * 放开等于让调用方决定往哪个目录写。
 */
export class StoreUploadDto {
  @IsIn(Object.keys(UploadService.CATEGORIES), {
    message: `category 必须是 ${Object.keys(UploadService.CATEGORIES).join(' / ')} 之一`,
  })
  category!: string;

  /** 原始文件名（决定扩展名与落库信息）；multipart 下可由 file.originalname 提供 */
  @IsOptional()
  @IsString()
  @Length(1, 255)
  filename?: string;

  /** base64 形式的内容（JSON 传法）；multipart 传法忽略此字段 */
  @IsOptional()
  @IsString()
  dataBase64?: string;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  userId?: string;
}

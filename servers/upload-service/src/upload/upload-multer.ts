import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
import { getUploadRoot } from './upload-root';

/**
 * 按分类创建上传拦截器（HTTP 路由用）。
 *
 * Multer 配置**只有一份实现**（`UploadService.multerOptionsFor`），这里只负责
 * 「把进程内已生效的上传根目录接上去」—— 装饰器求值时拿不到 DI，用惰性取值函数绕开。
 * 这样控制器里不再有第二套 `diskStorage`（历史上正因两处各写一份而口径不一）。
 */
export function createUploadInterceptor(category: string) {
  return FileInterceptor('file', UploadService.multerOptionsFor(category, getUploadRoot));
}

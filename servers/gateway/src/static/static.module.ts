import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      serveStaticOptions: {
        index: ['index.html'],
        // /assets/* 带 hash 的文件已经在上层中间件设了 immutable 缓存
        // index.html 不做强缓存，保证部署后能获取最新资源路径
        setHeaders: (res, path) => {
          if (!path.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
        etag: true,
        lastModified: true,
      },
    }),
  ],
})
export class StaticModule {}

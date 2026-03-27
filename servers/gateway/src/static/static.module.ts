import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      serveRoot: '/',
      exclude: ['/api*'], // 排除 API 路由
      serveStaticOptions: {
        index: ['index.html'],
        maxAge: 3600000, // 1 hour cache
      },
    }),
  ],
})
export class StaticModule {}

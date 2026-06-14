import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      serveStaticOptions: {
        index: false, // SPA 回退由 SpaController 处理
        maxAge: 3600000, // 1 hour cache
      },
    }),
  ],
})
export class StaticModule {}

import { Module } from '@nestjs/common';
import { SwaggerDocsController } from './swagger-docs.controller';
import { SwaggerDocsService } from './swagger-docs.service';

@Module({
  controllers: [SwaggerDocsController],
  providers: [SwaggerDocsService],
})
export class SwaggerDocsModule {}

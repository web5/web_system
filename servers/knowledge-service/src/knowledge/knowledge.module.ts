import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { KnowledgeCollectionEntity } from './entities/knowledge-collection.entity';
import { KnowledgeDocEntity } from './entities/knowledge-doc.entity';
import { KnowledgeChunkEntity } from './entities/knowledge-chunk.entity';
import { TokenHubEmbeddingService } from './embedding.service';
import { KnowledgeCollectionService } from './collections.service';
import { KnowledgeDocumentService } from './documents.service';
import { KnowledgeSearchService } from './search.service';
import { KnowledgeAdminController } from './knowledge.admin.controller';
import { KnowledgeInternalController } from './knowledge.internal.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeCollectionEntity,
      KnowledgeDocEntity,
      KnowledgeChunkEntity,
    ]),
    AuthModule,
  ],
  providers: [
    TokenHubEmbeddingService,
    KnowledgeCollectionService,
    KnowledgeDocumentService,
    KnowledgeSearchService,
  ],
  controllers: [KnowledgeAdminController, KnowledgeInternalController],
  exports: [KnowledgeSearchService],
})
export class KnowledgeModule {}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BusinessException } from '../common/exceptions/business.exception';
import { InternalKeyGuard } from '../auth/internal-key.guard';
import { KnowledgeCollectionService } from './collections.service';
import { KnowledgeDocumentService } from './documents.service';
import { KnowledgeSearchService } from './search.service';
import { RagEvaluationService } from './rag-eval.service';
import { DeleteKnowledgeDto, IngestDocDto, RunEvalDto, SearchQueryDto } from './dto';

/**
 * MCP 工具族 internal 接口（mcp-gateway seed 的 knowledge 模块直连 6011，
 * Bearer <INTERNAL_API_KEY>）。对应 D4.3 工具契约：
 *   knowledge_search / knowledge_list / knowledge_status / knowledge_ingest / knowledge_delete
 * 集合级 enabled 校验在此执行（开放决策 7：集合随 agent 定义装配绑定在 ai-agent 侧）。
 */
@Controller('knowledge/mcp')
@UseGuards(InternalKeyGuard)
export class KnowledgeInternalController {
  constructor(
    private readonly collections: KnowledgeCollectionService,
    private readonly documents: KnowledgeDocumentService,
    private readonly search: KnowledgeSearchService,
    private readonly evalService: RagEvaluationService,
  ) {}

  @Get('search')
  runSearch(@Query() query: SearchQueryDto) {
    return this.search.search(query.collectionId, query.query, query.topK ?? 5);
  }

  @Get('list')
  listCollections() {
    return this.search.mcpList();
  }

  @Get('status/:docId')
  status(@Param('docId') docId: string) {
    return this.documents.status(docId);
  }

  @Post('ingest')
  ingest(@Body() dto: IngestDocDto) {
    return this.documents.ingest(dto);
  }

  /** Ragas 三指标评测（3.5）：检索+问答对 → context/answer relevance + faithfulness 汇总 */
  @Post('eval')
  runEval(@Body() dto: RunEvalDto) {
    return this.evalService.evaluate(
      dto.collectionId,
      dto.cases.map((c) => c.question),
      dto.topK ?? 5,
    );
  }

  @Post('delete')
  async delete(@Body() dto: DeleteKnowledgeDto) {
    if (dto.docId) {
      await this.documents.removeDoc(dto.docId);
      return { deleted: 'doc', docId: dto.docId };
    }
    if (dto.collectionId) {
      await this.collections.remove(dto.collectionId);
      return { deleted: 'collection', collectionId: dto.collectionId };
    }
    throw new BusinessException('delete 需提供 docId 或 collectionId');
  }
}

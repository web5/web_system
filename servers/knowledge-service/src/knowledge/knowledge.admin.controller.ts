import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { PermissionGuard, RequirePermission } from '@web-system/shared';
import { AuthGuard } from '../auth/auth.guard';
import { KnowledgeCollectionService } from './collections.service';
import { KnowledgeDocumentService } from './documents.service';
import { KnowledgeSearchService } from './search.service';
import {
  CreateCollectionDto,
  IngestDocDto,
  SearchQueryDto,
  ToggleCollectionDto,
  UpdateCollectionDto,
} from './dto';

/**
 * Admin 管理接口（经 gateway /api/knowledge → 本服务）。
 * 写操作 knowledge:manage，读操作 knowledge:view（W4：缺权限 403）。
 */
@Controller('knowledge')
@UseGuards(AuthGuard, PermissionGuard)
export class KnowledgeAdminController {
  constructor(
    private readonly collections: KnowledgeCollectionService,
    private readonly documents: KnowledgeDocumentService,
    private readonly search: KnowledgeSearchService,
  ) {}

  // ── 集合 CRUD ──
  @Get('collections')
  @RequirePermission('knowledge:view')
  listCollections() {
    return this.collections.list();
  }

  @Post('collections')
  @RequirePermission('knowledge:manage')
  createCollection(@Body() dto: CreateCollectionDto, @Req() req: Request) {
    const user = (req as Request & { user?: { id?: string } }).user;
    return this.collections.create({ ...dto, createdBy: user?.id });
  }

  @Put('collections/:id')
  @RequirePermission('knowledge:manage')
  updateCollection(@Param('id') id: string, @Body() dto: UpdateCollectionDto) {
    return this.collections.update(id, dto);
  }

  @Post('collections/:id/toggle')
  @RequirePermission('knowledge:manage')
  toggleCollection(@Param('id') id: string, @Body() dto: ToggleCollectionDto) {
    return this.collections.toggle(id, dto.enabled);
  }

  @Delete('collections/:id')
  @RequirePermission('knowledge:manage')
  async removeCollection(@Param('id') id: string) {
    await this.collections.remove(id);
    return { deleted: true };
  }

  // ── 文档管理 ──
  @Get('documents')
  @RequirePermission('knowledge:view')
  listDocuments(@Query('collectionId') collectionId?: string, @Query('status') status?: string) {
    const s =
      status === 'parsing' || status === 'ready' || status === 'failed' ? status : undefined;
    return this.documents.list(collectionId, s);
  }

  @Get('documents/:id')
  @RequirePermission('knowledge:view')
  getDocument(@Param('id') id: string) {
    return this.documents.detail(id);
  }

  @Delete('documents/:id')
  @RequirePermission('knowledge:manage')
  async removeDocument(@Param('id') id: string) {
    await this.documents.removeDoc(id);
    return { deleted: true };
  }

  @Post('documents')
  @RequirePermission('knowledge:manage')
  ingestDocument(@Body() dto: IngestDocDto) {
    return this.documents.ingest(dto);
  }

  // ── 检索（调试器/QA 试跑） ──
  @Get('search')
  @RequirePermission('knowledge:view')
  runSearch(@Query() query: SearchQueryDto) {
    return this.search.search(query.collectionId, query.query, query.topK ?? 5);
  }
}

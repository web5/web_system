import { Controller, Get, Post, Param, Query, Body, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import { ROLE_PERMISSIONS } from '@web-system/types';
import { RequirePermission } from '../auth/decorators';
import { DatabaseExplorerService } from './database-explorer.service';
import { QueryRowsDto } from './dto/query-rows.dto';
import { QuerySqlDto } from './dto/query-sql.dto';

type AuthedRequest = Request & { user?: { username?: string; roles?: string[] } };

@ApiTags('数据库浏览')
@ApiBearerAuth()
@Controller('admin/db')
export class DatabaseExplorerController {
  constructor(private readonly service: DatabaseExplorerService) {}

  @Get('tables')
  @RequirePermission('database:view')
  @ApiOperation({ summary: '业务表列表（敏感表仅 super_admin 可见）' })
  async listTables(@Req() req: AuthedRequest) {
    // 敏感表仅在持有 database:query（即 super_admin）时返回
    const canSeeSensitive = this.grantedPermissions(req.user?.roles).includes('database:query');
    return { code: 0, data: await this.service.listTables({ canSeeSensitive }) };
  }

  @Get('tables/:name/schema')
  @RequirePermission('database:view')
  @ApiOperation({ summary: '表结构（字段 + 索引，标注敏感级别）' })
  async getSchema(@Param('name') name: string) {
    return { code: 0, data: await this.service.getSchema(name) };
  }

  @Get('tables/:name/rows')
  @RequirePermission('database:view')
  @ApiOperation({ summary: '分页查询表数据（服务端自动脱敏）' })
  async getRows(@Param('name') name: string, @Query() query: QueryRowsDto) {
    const data = await this.service.getRows(name, {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 50,
      sortField: query.sortField,
      sortOrder: query.sortOrder,
    });
    return { code: 0, data };
  }

  @Post('query')
  @RequirePermission('database:query')
  @ApiOperation({ summary: '执行只读 SQL（仅 super_admin，自动 LIMIT 200 并写审计日志）' })
  async runQuery(@Body() dto: QuerySqlDto, @Req() req: AuthedRequest) {
    const data = await this.service.runQuery(dto.sql, {
      username: req.user?.username ?? 'unknown',
      ip: req.ip,
    });
    return { code: 0, data };
  }

  private grantedPermissions(roles?: string[]): string[] {
    return (roles ?? []).flatMap(
      (role) => (ROLE_PERMISSIONS as Record<string, string[]>)[role] ?? [],
    );
  }
}

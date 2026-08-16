import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ServerService } from './server.service';
import { ServerDto, EnvServiceRouteDto } from '../common/dto';

@ApiTags('服务器组')
@Controller('servers')
export class ServerController {
  constructor(private readonly serverService: ServerService) {}

  @Get()
  @ApiOperation({ summary: '列出服务器（可按 serverName 过滤）' })
  list(@Query('serverName') serverName?: string) {
    return this.serverService.listServers(serverName);
  }

  @Post()
  @ApiOperation({ summary: '新增服务器（归属某 serverName 组）' })
  create(@Body() dto: ServerDto) {
    return this.serverService.createServer(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除服务器' })
  remove(@Param('id') id: string) {
    return this.serverService.removeServer(id);
  }
}

@ApiTags('环境服务路由')
@Controller('env-service-routes')
export class EnvServiceRouteController {
  constructor(private readonly serverService: ServerService) {}

  @Get('overview')
  @ApiOperation({ summary: '服务地址总览（服务 × 环境 大表格数据）' })
  overview() {
    return this.serverService.getServiceOverview();
  }

  @Get()
  @ApiOperation({ summary: '列出环境服务路由（可按 env 过滤）' })
  list(@Query('env') env?: string) {
    return this.serverService.listRoutes(env);
  }

  @Post()
  @ApiOperation({ summary: '新增/更新环境服务路由（服务名 → serverName）' })
  create(@Body() dto: EnvServiceRouteDto) {
    return this.serverService.createRoute(dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除环境服务路由' })
  remove(@Param('id') id: string) {
    return this.serverService.removeRoute(id);
  }
}

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { EnvironmentService } from './environment.service';
import { EnvironmentDto } from '../common/dto';

@ApiTags('环境管理')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('environments')
export class EnvironmentController {
  constructor(private readonly envService: EnvironmentService) {}

  @Get()
  @ApiOperation({ summary: '列出所有环境' })
  async list() {
    return this.envService.list();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个环境' })
  async get(@Param('id') id: string) {
    return this.envService.get(id);
  }

  @Post()
  @ApiOperation({ summary: '创建环境' })
  async create(@Body() dto: EnvironmentDto) {
    return this.envService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: '更新环境（端口/SSH 等）' })
  async update(@Param('id') id: string, @Body() dto: Partial<EnvironmentDto>) {
    return this.envService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除环境（内置环境不可删）' })
  async remove(@Param('id') id: string) {
    return this.envService.remove(id);
  }
}

import { Controller, Get, Post, Put, Delete, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TodoService } from './todo.service';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { QueryTodoDto } from './dto/query-todo.dto';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('Todo List')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('todos')
export class TodoController {
  constructor(private readonly todoService: TodoService) {}

  @Get()
  @ApiOperation({ summary: '获取任务列表' })
  async findAll(@Query() query: QueryTodoDto, @Request() req) {
    const userId = req.user?.id;
    const data = await this.todoService.findAll(query, userId);
    return { code: 200, data };
  }

  @Get('stats')
  @ApiOperation({ summary: '获取任务统计' })
  async getStats(@Query('period') period: string = 'today', @Request() req) {
    const userId = req.user?.id;
    const data = await this.todoService.getStats(userId, period);
    return { code: 200, data };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取任务详情' })
  async findOne(@Param('id') id: number, @Request() req) {
    const userId = req.user?.id;
    const data = await this.todoService.findOne(id, userId);
    return { code: 200, data };
  }

  @Post()
  @ApiOperation({ summary: '创建任务' })
  async create(@Body() createTodoDto: CreateTodoDto, @Request() req) {
    const userId = req.user?.id;
    const data = await this.todoService.create(createTodoDto, userId);
    return { code: 201, data, message: '任务创建成功' };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新任务' })
  async update(@Param('id') id: number, @Body() updateTodoDto: UpdateTodoDto, @Request() req) {
    const userId = req.user?.id;
    const data = await this.todoService.update(id, updateTodoDto, userId);
    return { code: 200, data, message: '任务更新成功' };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除任务' })
  async remove(@Param('id') id: number, @Request() req) {
    const userId = req.user?.id;
    await this.todoService.remove(id, userId);
    return { code: 200, message: '任务删除成功' };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '更新任务状态' })
  async updateStatus(@Param('id') id: number, @Body('status') status: string, @Request() req) {
    const userId = req.user?.id;
    const data = await this.todoService.updateStatus(id, status, userId);
    return { code: 200, data, message: '任务状态更新成功' };
  }
}

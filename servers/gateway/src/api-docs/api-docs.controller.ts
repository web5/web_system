import { Controller, Get, Post, Put, Delete, All, Body, Param, Query, Req, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiQuery, ApiBearerAuth, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ProxyService } from '../proxy/proxy.service';
import {
  LoginDto,
  RegisterDto,
  WechatLoginDto,
  MiniprogramLoginDto,
  CreateUserDto,
  UpdateUserDto,
} from './dto/api.dto';

@ApiTags('认证')
@Controller('api/auth')
export class ApiAuthController {
  constructor(private proxyService: ProxyService) {}

  @Post('login')
  @ApiOperation({ summary: '用户名密码登录' })
  @ApiBody({ type: LoginDto })
  login(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAuthProxy()(req, res, () => {
      res.status(500).json({ message: 'Auth service unavailable' });
    });
  }

  @Post('register')
  @ApiOperation({ summary: '用户注册' })
  @ApiBody({ type: RegisterDto })
  register(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAuthProxy()(req, res, () => {
      res.status(500).json({ message: 'Auth service unavailable' });
    });
  }

  @Post('wechat-login')
  @ApiOperation({ summary: '微信扫码登录（公众号/网页）' })
  @ApiBody({ type: WechatLoginDto })
  wechatLogin(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAuthProxy()(req, res, () => {
      res.status(500).json({ message: 'Auth service unavailable' });
    });
  }

  @Post('miniprogram-login')
  @ApiOperation({ summary: '微信小程序登录' })
  @ApiBody({ type: MiniprogramLoginDto })
  miniprogramLogin(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAuthProxy()(req, res, () => {
      res.status(500).json({ message: 'Auth service unavailable' });
    });
  }

  @All(':path(*)')
  @ApiExcludeEndpoint()
  proxyAll(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAuthProxy()(req, res, () => {
      res.status(500).json({ message: 'Auth service unavailable' });
    });
  }
}

@ApiTags('用户管理')
@Controller('api/users')
export class ApiUsersController {
  constructor(private proxyService: ProxyService) {}

  @Get()
  @ApiOperation({ summary: '获取用户列表' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  getUsers(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createUserProxy()(req, res, () => {
      res.status(500).json({ message: 'User service unavailable' });
    });
  }

  @Get('profile')
  @ApiOperation({ summary: '获取用户资料' })
  @ApiQuery({ name: 'id', required: false, description: '用户 ID' })
  @ApiBearerAuth()
  getProfile(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createUserProxy()(req, res, () => {
      res.status(500).json({ message: 'User service unavailable' });
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '根据 ID 获取用户' })
  getById(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createUserProxy()(req, res, () => {
      res.status(500).json({ message: 'User service unavailable' });
    });
  }

  @Post()
  @ApiOperation({ summary: '创建用户' })
  @ApiBody({ type: CreateUserDto })
  createUser(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createUserProxy()(req, res, () => {
      res.status(500).json({ message: 'User service unavailable' });
    });
  }

  @Put(':id')
  @ApiOperation({ summary: '更新用户' })
  @ApiBody({ type: UpdateUserDto })
  updateUser(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createUserProxy()(req, res, () => {
      res.status(500).json({ message: 'User service unavailable' });
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除用户' })
  removeUser(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createUserProxy()(req, res, () => {
      res.status(500).json({ message: 'User service unavailable' });
    });
  }

  @All(':path(*)')
  @ApiExcludeEndpoint()
  proxyUsersAll(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createUserProxy()(req, res, () => {
      res.status(500).json({ message: 'User service unavailable' });
    });
  }
}

@ApiTags('AI 能力')
@Controller('api/ai')
export class ApiAiController {
  constructor(private proxyService: ProxyService) {}

  @Post('chat')
  @ApiOperation({ summary: '发送 AI 对话消息' })
  chat(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAiProxy()(req, res, () => {
      res.status(500).json({ message: 'AI service unavailable' });
    });
  }

  @Get('conversations')
  @ApiOperation({ summary: '获取对话列表' })
  @ApiBearerAuth()
  getConversations(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAiProxy()(req, res, () => {
      res.status(500).json({ message: 'AI service unavailable' });
    });
  }

  @Post('image/submit')
  @ApiOperation({ summary: '提交图片生成任务' })
  @ApiBody({ description: 'prompt - 图片描述文本' })
  @ApiBearerAuth()
  submitImage(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAiProxy()(req, res, () => {
      res.status(500).json({ message: 'AI service unavailable' });
    });
  }

  @Post('image/query')
  @ApiOperation({ summary: '查询图片生成结果' })
  @ApiBody({ description: 'id - 任务 ID' })
  @ApiBearerAuth()
  queryImage(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAiProxy()(req, res, () => {
      res.status(500).json({ message: 'AI service unavailable' });
    });
  }

  @All(':path(*)')
  @ApiExcludeEndpoint()
  proxyAiAll(@Req() req: Request, @Res() res: Response) {
    return this.proxyService.createAiProxy()(req, res, () => {
      res.status(500).json({ message: 'AI service unavailable' });
    });
  }
}

import { Controller, Post, Get, Body, Query, Req, Res, Headers, HttpCode, HttpStatus, UnauthorizedException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { QrcodeService } from '../qrcode/qrcode.service';
import {
  WechatLoginRequest,
  MiniprogramLoginRequest,
  LoginResponse,
  MiniprogramLoginResponse,
} from '@web-system/types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Request, Response } from 'express';
import {
  resolveAuthClient,
  readRefreshCookie,
  setRefreshCookie,
  clearRefreshCookie,
  isSecureCookieEnv,
} from './refresh-cookie';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private qrcodeService: QrcodeService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * 下发 refresh cookie（方案 2 · S1）。
   *
   * 为什么同时保留 body 里的 refreshToken：老前端（及小程序）仍从响应体读，
   * cookie 是**增量**能力，二者并存才不会在发版瞬间打断存量客户端。
   */
  private attachRefreshCookie(req: Request, res: Response, refreshToken: string): void {
    const nodeEnv = this.configService.get<string>('NODE_ENV') || process.env.NODE_ENV;
    setRefreshCookie(res, resolveAuthClient(req), refreshToken, isSecureCookieEnv(nodeEnv));
  }

  private secureCookie(): boolean {
    const nodeEnv = this.configService.get<string>('NODE_ENV') || process.env.NODE_ENV;
    return isSecureCookieEnv(nodeEnv);
  }

  @Post('login')
  @ApiOperation({ summary: '用户名密码登录' })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(loginDto);
    this.attachRefreshCookie(req, res, result.refreshToken);
    return result;
  }

  @Post('register')
  @ApiOperation({ summary: '用户注册' })
  @HttpCode(HttpStatus.OK)
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.register(registerDto);
    this.attachRefreshCookie(req, res, result.refreshToken);
    return result;
  }

  @Post('wechat-login')
  @ApiOperation({ summary: '微信扫码登录' })
  @HttpCode(HttpStatus.OK)
  async wechatLogin(
    @Body() wechatDto: WechatLoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.wechatLogin(wechatDto);
    this.attachRefreshCookie(req, res, result.refreshToken);
    return result;
  }

  @Post('miniprogram-login')
  @ApiOperation({ summary: '微信小程序登录' })
  @HttpCode(HttpStatus.OK)
  async miniprogramLogin(@Body() mpDto: MiniprogramLoginRequest): Promise<MiniprogramLoginResponse> {
    // 小程序侧没有浏览器 cookie 语义，凭据走 wx.storage + Bearer，故不下发 cookie
    return this.authService.miniprogramLogin(mpDto);
  }

  @Post('refresh')
  @ApiOperation({ summary: '刷新 Token' })
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body('refreshToken') refreshToken: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const client = resolveAuthClient(req);
    // 优先 body（老客户端），其次 httpOnly cookie（新客户端，脚本读不到 token）
    const token = refreshToken || readRefreshCookie(req, client) || '';
    if (!token) {
      throw new UnauthorizedException('缺少 refreshToken');
    }
    const result = await this.authService.refreshToken(token);
    // 轮换后同步 cookie，避免客户端继续持旧的（cookie 侧跟随最新一次签发）
    this.attachRefreshCookie(req, res, result.refreshToken);
    return result;
  }

  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出' })
  @HttpCode(HttpStatus.OK)
  async logout(
    @Headers('authorization') auth: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean }> {
    // 无凭证直接 401：此前会「静默成功」，导致前端以为已登出而服务端并未作废
    const token = auth?.replace(/^Bearer\s+/i, '');
    if (!token) {
      throw new UnauthorizedException('缺少 Authorization 头');
    }
    await this.authService.logout(token);
    // access 进黑名单之外，必须同时把 refresh cookie 清掉：
    // 否则 cookie 里那颗 refresh 还能继续换新 token（脚本读不到但浏览器会自动带上）
    clearRefreshCookie(res, this.secureCookie());
    return { success: true };
  }

  @Get('verify')
  @ApiOperation({ summary: '验证 Token 并返回用户信息' })
  @HttpCode(HttpStatus.OK)
  async verify(@Headers('authorization') auth: string) {
    if (!auth) {
      throw new UnauthorizedException('Authorization header missing');
    }
    const token = auth.replace('Bearer ', '');
    const user = await this.authService.verifyToken(token);
    return { code: 200, data: user };
  }

  /**
   * 微信 OAuth 授权入口 —— 重定向到微信授权页面
   * GET /auth/wechat/authorize
   *
   * 支持两种场景：
   * 1. 微信内置浏览器 → 微信公众号 OAuth（snsapi_userinfo 静默授权）
   * 2. 桌面浏览器 → 微信开放平台网站应用 QR 登录（snsapi_login）
   */
  @Get('wechat/authorize')
  @ApiOperation({ summary: '微信网页授权跳转' })
  redirectToWechat(
    @Query('redirect') redirect: string,
    @Res() res: Response,
  ) {
    const authUrl = this.authService.buildWechatOAuthUrl(redirect);
    res.redirect(authUrl);
  }

  /**
   * 微信 OAuth 回调 —— 微信授权后带 code 回调到这里
   * 支持两种来源：
   * 1. 普通微信登录 (state = 前端回调 URL)
   * 2. 扫码登录 mini-scan (state 含 mini_scan_ticket=xxx)
   * GET /auth/wechat/callback?code=xxx&state=xxx
   */
  @Get('wechat/callback')
  @ApiOperation({ summary: '微信网页授权回调' })
  async wechatCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      const result = await this.authService.handleWechatOAuthCallback(code, state);
      const frontendUrl = state
        ? decodeURIComponent(state)
        : '/';

      // 检查是否是 mini-scan 扫码登录（从 QR 码进入）
      const ticketMatch = frontendUrl.match(/mini_scan_ticket=([^&]+)/);
      if (ticketMatch) {
        const ticketId = ticketMatch[1];
        await this.qrcodeService.confirmOAuthTicket(
          ticketId,
          result.user.id,
          result.accessToken,
          result.refreshToken,
        );
      }

      // 将 token 通过 URL 参数传回前端
      const cleanUrl = frontendUrl.split('?')[0] || '/';
      const separator = cleanUrl.includes('?') ? '&' : '?';
      res.redirect(
        `${cleanUrl}${separator}token=${result.accessToken}&refreshToken=${result.refreshToken}`,
      );
    } catch (error) {
      this.logger.error(
        `OAuth callback failed: ${(error as Error)?.message || error}`,
        (error as Error)?.stack,
      );
      res.redirect('/login?error=wechat_auth_failed');
    }
  }

  /**
   * 绑定小程序 openid 到当前用户（个人中心）
   * POST /auth/bind-miniprogram
   * Body: { code: string } — wx.login() 获取的 code
   */
  @Post('bind-miniprogram')
  @ApiBearerAuth()
  @ApiOperation({ summary: '绑定小程序 openid 到当前用户' })
  @HttpCode(HttpStatus.OK)
  async bindMiniprogram(
    @Body('code') code: string,
    @Headers('authorization') auth: string,
  ) {
    if (!auth) throw new UnauthorizedException('请先登录');
    const token = auth.replace('Bearer ', '');
    const payload = this.jwtService.verify(token);
    await this.authService.bindMpOpenid(payload.sub, code);
    return { success: true, message: '小程序绑定成功' };
  }

  /**
   * 绑定公众号 openid 到当前用户（个人中心）
   * POST /auth/bind-official-account
   * Body: { code: string } — 公众号 OAuth 回调的 code
   */
  @Post('bind-official-account')
  @ApiBearerAuth()
  @ApiOperation({ summary: '绑定公众号 openid 到当前用户' })
  @HttpCode(HttpStatus.OK)
  async bindOfficialAccount(
    @Body('code') code: string,
    @Headers('authorization') auth: string,
  ) {
    if (!auth) throw new UnauthorizedException('请先登录');
    const token = auth.replace('Bearer ', '');
    const payload = this.jwtService.verify(token);
    await this.authService.bindOaOpenid(payload.sub, code);
    return { success: true, message: '公众号绑定成功' };
  }
}

import {
  Controller,
  Get,
  Param,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import * as path from 'path';
import { ReleaseGitService } from './release-git.service';
import { ModuleRegistryService } from '../module-registry/module-registry.service';

/**
 * 分支列表接口（**仅控制台 JWT**）。
 *
 * 用例：发布中心「发起发布」抽屉点击分支下拉时调用，
 * 通过 git 拉取远程分支（origin/*），按 committerdate 倒序返回。
 *
 * 由于 monorepo 所有模块共用一个仓库，模块自己的 dir 通常是仓库子目录；
 * 这里采取「获取模块 dir 后 cd 进去再列分支」，失败兜底为仓库根。
 * （即使有人把模块建在 git worktree 也不会崩，最多拿到 worktree 可见的分支子集。）
 */
@ApiTags('分支')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('modules')
export class BranchController {
  constructor(
    private readonly git: ReleaseGitService,
    private readonly modules: ModuleRegistryService,
  ) {}

  @Get(':key/branches')
  @ApiOperation({ summary: '列出模块对应代码目录的远程分支（origin/*，已去掉 origin/）' })
  async listBranches(@Param('key') key: string): Promise<{
    branches: string[];
    current: string | null;
    head: string | null;
  }> {
    if (!key || !/^[a-z0-9-]+$/i.test(key)) {
      throw new BadRequestException('模块 key 不合法');
    }
    const ws = this.git.workspace();
    let dir = ws;
    try {
      const m = await this.modules.get(key);
      if (m.dir) {
        const candidate = path.join(ws, m.dir);
        // 仅当目录存在且避免目录穿越
        if (candidate.startsWith(ws + path.sep) || candidate === ws) {
          dir = candidate;
        }
      }
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      // 模块未找到也允许给个空分支列表（前端兜底 master）
    }
    const branches = this.git.listRemoteBranches({ dir, maxCount: 200 });
    let current: string | null = null;
    let head: string | null = null;
    try {
      current = this.git.branchName(dir);
      head = this.git.fullHead(dir);
    } catch {
      // 容忍：仓库尚未 checkout 时 current/head 可能为 'HEAD'
    }
    return { branches, current, head };
  }
}

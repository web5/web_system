import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { DeployAppEnvVersionEntity } from '../entities/deploy-app-env-version.entity';
import { EnvsService } from '../envs/envs.service';
import { AppsService } from './apps.service';
import { defaultReleaseWorkspace } from '../pipeline/release-paths';
import {
  envArtifactsDir,
  envEntryUrl,
  envVersionDir,
  writeEnvEntryPointer,
} from './entry-pointer';

export interface PublishLocalResult {
  appKey: string;
  envId: string;
  version: string;
  /** 版本产物目录（绝对路径） */
  artifactDir: string;
  /** 入口指针文件（绝对路径） */
  pointerFile: string;
  /** 前端加载地址（固定、不含版本） */
  entryUrl: string;
  previousVersion: string | null;
}

/**
 * 应用产物投递 + 激活（微前端域本地投递）
 *
 * 设计依据：specs/deploy-console-domain-split/design.md v2 §3/§5（AppDeployStrategy 的本地路径）
 *
 * 动作链 = 构建产物 → 写入 `<key>/<envId>/<version>/` → **改写 `<key>/<envId>/index.js` 指针**
 *          → 更新 `deploy_app_env_versions`（current/previous）。**永不触碰 pm2**（FR-4.3）。
 *
 * 与流水线的分工：流水线负责「构建 + 版本标签」，本服务负责「落盘 + 激活」。
 * 产物源目录由 `apps/<repoDir>/dist` 推导（**不接受调用方传路径**，避免任意目录拷贝）。
 */
@Injectable()
export class AppArtifactService {
  private readonly logger = new Logger(AppArtifactService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(DeployAppEnvVersionEntity)
    private readonly versionRepo: Repository<DeployAppEnvVersionEntity>,
    private readonly appsService: AppsService,
    private readonly envsService: EnvsService,
  ) {}

  private get workspace(): string {
    return this.configService.get<string>('RELEASE_WORKSPACE') || defaultReleaseWorkspace();
  }

  /** 构建产物源目录（约定：apps/<repoDir>/dist） */
  buildOutputDir(repoDir: string): string {
    return path.join(this.workspace, 'apps', repoDir, 'dist');
  }

  /** 清空目录内容（保留目录本身），避免旧文件残留导致「新版本里混着旧分包」 */
  private clearDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, f), { recursive: true, force: true });
    }
  }

  /**
   * 本地投递并激活（发布到某环境的某版本）。
   * 幂等：同版本重复投递 = 覆盖同目录后再改指针（结果一致）。
   */
  async publishLocal(
    appKey: string,
    envId: string,
    version: string,
    operator?: string,
  ): Promise<PublishLocalResult> {
    const app = await this.appsService.getApp(appKey);
    await this.envsService.getEnv(envId);

    if (app.deployMode !== 'env-dir') {
      throw new BadRequestException(
        `应用 ${appKey} 的部署模式为 ${app.deployMode}（基座按站点+版本），不走环境目录投递`,
      );
    }
    const v = String(version || '').trim();
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(v)) {
      throw new BadRequestException(`版本标签非法（允许字母/数字/._-）：${version}`);
    }

    const src = this.buildOutputDir(app.repoDir);
    if (!fs.existsSync(src) || !fs.existsSync(path.join(src, 'index.js'))) {
      throw new BadRequestException(
        `构建产物不存在或缺入口文件：${src}/index.js（请先完成构建）`,
      );
    }

    // ① 写入版本目录（清空后整拷）
    const artifactDir = envVersionDir(this.workspace, appKey, envId, v);
    this.clearDir(artifactDir);
    fs.cpSync(src, artifactDir, { recursive: true });

    // ② 改写入口指针（固定路径，no-cache，发布即生效）
    const pointer = writeEnvEntryPointer(this.workspace, appKey, envId, v);

    // ③ 更新版本指针表（previous = 原 current）
    const row = await this.ensureRow(appKey, envId);
    const previousVersion = row.currentVersion ?? null;
    row.previousVersion = previousVersion;
    row.currentVersion = v;
    row.status = 'deployed';
    row.deployedAt = new Date();
    row.deployedBy = operator ?? null;
    await this.versionRepo.save(row);

    this.logger.log(
      `应用产物已激活：${appKey}/${envId} → ${v}（上一版本 ${previousVersion ?? '-'}）目录 ${envArtifactsDir(
        this.workspace,
        appKey,
        envId,
      )}`,
    );

    return {
      appKey,
      envId,
      version: v,
      artifactDir,
      pointerFile: pointer.js,
      entryUrl: envEntryUrl(appKey, envId),
      previousVersion,
    };
  }

  private async ensureRow(appKey: string, envId: string) {
    const found = await this.versionRepo.findOne({ where: { appKey, envId } });
    return found || this.versionRepo.create({ appKey, envId, status: 'unknown' });
  }
}

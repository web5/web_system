import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as releasePaths from '../pipeline/release-paths';
import { CommandService } from '../shell/command.service';

export interface RemoteTarget {
  remoteHost: string;
  remoteUser?: string;
}

/**
 * 投递各阶段默认超时（诊断 #11）。
 *
 * 原实现三次 `command.exec` 都不传 `timeoutMs`（`CommandService.exec` 默认 0 = **不超时**），
 * 远端 scp 半开或 ssh 卡住时，发布流水线会永久停在这一步：既不失败也不推进，
 * 锁一直握着，该模块直到 TTL 30 分钟过期都不可再发布。
 *
 * 可配：`REMOTE_DELIVERY_TAR_TIMEOUT_MS` / `_SCP_` / `_SSH_`（单位 ms）。
 */
const DELIVERY_TIMEOUT_MS = {
  tar: 5 * 60 * 1000,
  scp: 15 * 60 * 1000,
  ssh: 10 * 60 * 1000,
} as const;

export interface RemoteDeliveryResult {
  sshTarget: string;
  dest: string;
}

/**
 * 远程投递工具（upload 内置步骤 remote 分支的执行体）。
 *
 * 收敛自 pipeline.service.ts 的 stageUpload(remote) + readRemoteTarget：
 * 服务器地址按环境从配置读取（prod→PROD_SERVER/PROD_USER，其余→DEV_SERVER/DEV_USER），
 * 产物 tar → scp 到 /tmp → ssh 解压到远端 gateway 静态目录（路径布局与发布目录一致）。
 */
@Injectable()
export class RemoteDeliveryService {
  constructor(
    private readonly configService: ConfigService,
    private readonly command: CommandService,
  ) {}

  /** 读取远程投递目标（未配置则抛错提示可改用 target=local） */
  resolveTarget(env: string): RemoteTarget {
    const host =
      env === 'prod'
        ? this.configService.get<string>('PROD_SERVER')
        : this.configService.get<string>('DEV_SERVER');
    const user =
      env === 'prod'
        ? this.configService.get<string>('PROD_USER')
        : this.configService.get<string>('DEV_USER');
    if (!host) {
      throw new BadRequestException(
        `未配置 ${env} 服务器地址（DEV_SERVER/PROD_SERVER），无法远程投递；可改用 target=local`,
      );
    }
    return { remoteHost: host, remoteUser: user };
  }

  /** 阶段超时（env 覆盖，非法值回落默认） */
  private timeoutMs(stage: keyof typeof DELIVERY_TIMEOUT_MS): number {
    const key = `REMOTE_DELIVERY_${stage.toUpperCase()}_TIMEOUT_MS`;
    const raw = Number(this.configService.get<string>(key));
    return Number.isFinite(raw) && raw > 0 ? raw : DELIVERY_TIMEOUT_MS[stage];
  }

  /**
   * 远程投递 dist 产物：tar → scp → ssh 解压到远端
   * `<REMOTE_MODULES_ROOT>/<moduleKey>/<version>`，返回远端目标（供日志/result）。
   */
  uploadDist(input: { env: string; moduleKey: string; version: string; srcDir: string }): RemoteDeliveryResult {
    const { remoteHost, remoteUser } = this.resolveTarget(input.env);
    const sshTarget = remoteUser ? `${remoteUser}@${remoteHost}` : remoteHost;
    const dest = `${releasePaths.REMOTE_MODULES_ROOT}/${input.moduleKey}/${input.version}`;
    const tar = `/tmp/${input.moduleKey}-${input.version}.tar.gz`;
    const cwd = process.cwd();

    if (fs.existsSync(tar)) fs.rmSync(tar);
    this.command.exec(`tar czf ${tar} -C ${input.srcDir} .`, cwd, {}, this.timeoutMs('tar'));
    this.command.exec(
      `scp -o ConnectTimeout=15 ${tar} ${sshTarget}:/tmp/`,
      cwd,
      {},
      this.timeoutMs('scp'),
    );
    this.command.exec(
      `ssh -o ConnectTimeout=15 ${sshTarget} "mkdir -p ${dest} && cd ${dest} && rm -rf ./* && tar xzf /tmp/${path.basename(
        tar,
      )} && rm -f /tmp/${path.basename(tar)}"`,
      cwd,
      {},
      this.timeoutMs('ssh'),
    );
    fs.rmSync(tar, { force: true });
    return { sshTarget, dest };
  }
}

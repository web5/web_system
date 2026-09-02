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
    this.command.exec(`tar czf ${tar} -C ${input.srcDir} .`, cwd);
    this.command.exec(`scp -o ConnectTimeout=15 ${tar} ${sshTarget}:/tmp/`, cwd);
    this.command.exec(
      `ssh -o ConnectTimeout=15 ${sshTarget} "mkdir -p ${dest} && cd ${dest} && rm -rf ./* && tar xzf /tmp/${path.basename(
        tar,
      )} && rm -f /tmp/${path.basename(tar)}"`,
      cwd,
    );
    fs.rmSync(tar, { force: true });
    return { sshTarget, dest };
  }
}

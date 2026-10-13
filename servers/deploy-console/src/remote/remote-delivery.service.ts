import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as releasePaths from '../pipeline/release-paths';
import { CommandService } from '../shell/command.service';
import { SshExecService, SshTarget } from './ssh-exec.service';

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

/** 配置项读取器（`ConfigService.get<string>` 的形状，抽出来便于纯函数单测） */
export type ConfigGetter = (key: string) => string | undefined;

/**
 * 远端静态产物根（诊断 #3 遗留：此前是 `release-paths.ts` 里的硬编码常量）。
 *
 * 为什么不能硬编码一条路径：prod 的静态根**不在** gateway 目录下
 * （实测 `/data/web_system_static/public`，与 dev 的
 * `/data/web_system/servers/gateway/public` 完全不同）。硬编码的那条只适用于
 * 与控制台同机同布局的环境 —— 换台机器就是「投递成功但页面 404」，且日志看不出来。
 *
 * 取值优先级（与 `apps/static-target.ts` 同口径，避免两处再漂移）：
 * 1. `REMOTE_MODULES_ROOT_<ENV>`（显式指定，最直白）
 * 2. `STATIC_PUBLIC_ROOT_<ENV>` + `/static/modules`（静态根已在 #3 按环境配置过）
 * 3. 旧常量（保持既有行为，未配置时不会突然改投递落点）
 *
 * ⚠️ 抽成纯函数是为 S1「边界脚本化」服务：`upload` 节点改由脚本做 scp 时，
 * 落点仍必须由平台算好下发 —— 脚本各拼一遍这条链，迟早拼错成第 3 级默认值。
 */
export function resolveRemoteModulesRoot(get: ConfigGetter, env: string): string {
  const e = (env || '').toUpperCase();
  const explicit = (get(`REMOTE_MODULES_ROOT_${e}`) || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const staticRoot = (get(`STATIC_PUBLIC_ROOT_${e}`) || '').trim();
  // 静态根下的布局是 `static/modules`（见 apps/static-target.ts 的 envArtifactsRel），
  // 与**发布目录内**的 `servers/gateway/public/static/modules` 不是一回事 —— 混用会得到
  // `/data/web_system_static/public/servers/gateway/public/static/modules` 这种落点
  if (staticRoot) return `${staticRoot.replace(/\/+$/, '')}/static/modules`;

  return releasePaths.REMOTE_MODULES_ROOT;
}

/**
 * SSH 目标 + 私钥：**由 SshExecService 解析后传入**，本文件不做第二份推导。
 *
 * 背景（诊断 #15）：此前「环境 → 投递到哪台机器、用哪把钥匙」在本服务里按
 * `DEV_SERVER/PROD_SERVER` 环境变量算一份，`SshExecService`（发布/监控在用）按
 * 「主机管理 → 服务器管理」算第二份，边界脚本化时又会长出第三份。
 * 多份推导的后果是**同一模块配不配脚本会投到不同机器**，且日志全绿 —— 最难排查的那一类。
 * 故这里只接受解析结果；解析本身只有一个入口（`SshExecService.resolve`）。
 */
export interface RemoteScriptSsh {
  /** `user@host` */
  target: string;
  /** 私钥绝对路径（解析方已完成存在性校验；空串 = 未解析到目标机） */
  keyPath: string;
}

/** 把 SshExecService 的解析结果转成脚本变量形状（`user@host` 的拼法也只此一处） */
export function toRemoteScriptSsh(t: Pick<SshTarget, 'host' | 'username' | 'keyPath'>): RemoteScriptSsh {
  return { target: `${t.username}@${t.host}`, keyPath: t.keyPath };
}

/**
 * S1：给边界脚本的远端投递变量（平台算好，脚本只管用）。
 *
 * 空串 = 未配置；脚本必须**显式报错**而不是带着空串联到 `""` 目标机上
 * （模板 `upload-remote.sh` / `clean-remote.sh` 已这么做）。
 */
export interface RemoteScriptVars {
  REMOTE_SSH_TARGET: string;
  REMOTE_MODULES_ROOT: string;
  REMOTE_DEST_DIR: string;
  SSH_KEY_PATH: string;
}

export function resolveRemoteScriptVars(
  get: ConfigGetter,
  input: {
    env: string;
    moduleKey: string;
    /** 版本（commit 短哈希 / 版本引用）；为空时不出 Dest 目录 */
    version?: string;
    /**
     * 目标机与私钥（`SshExecService.resolve` 的结果）。
     * 未解析到（环境没登记主机 / 私钥缺失）时传 null → 两个 SSH 变量留空，
     * 由脚本在使用点显式报错（见 `scripts/pipeline/upload-remote.sh`）。
     */
    ssh?: RemoteScriptSsh | null;
  },
): RemoteScriptVars {
  const root = resolveRemoteModulesRoot(get, input.env);
  const sshTarget = input.ssh?.target ?? '';
  const keyPath = input.ssh?.keyPath ?? '';
  return {
    REMOTE_SSH_TARGET: sshTarget,
    REMOTE_MODULES_ROOT: root,
    REMOTE_DEST_DIR: root && input.version ? `${root}/${input.moduleKey}/${input.version}` : '',
    SSH_KEY_PATH: keyPath,
  };
}

/**
 * 远程投递工具（upload 内置步骤 remote 分支的执行体）。
 *
 * 收敛自 pipeline.service.ts 的 stageUpload(remote) + readRemoteTarget：
 * 产物 tar → scp 到 /tmp → ssh 解压到远端 gateway 静态目录（路径布局与发布目录一致）。
 *
 * ⚠️ **目标机不在这里算**（2026-10-13）：此前按环境的 `DEV_SERVER/PROD_SERVER` 取，
 * 与发布/监控走的「主机管理」不是同一份来源；现在统一委托 `SshExecService.resolve`，
 * 平台内置执行体与边界脚本因此拿到**同一个**目标机。
 */
@Injectable()
export class RemoteDeliveryService {
  constructor(
    private readonly configService: ConfigService,
    private readonly command: CommandService,
    // SSH 目标机的唯一真相源（主机管理 → 服务器管理）
    private readonly sshExec: SshExecService,
  ) {}

  /**
   * 远端 SSH 目标（异步：要查「主机管理」）。
   *
   * 原实现按环境的 `DEV_SERVER/PROD_SERVER` 环境变量取，与发布/监控用的一台机器
   * 不是同一份来源 —— 两边的 deployments 指向不同机器时，日志同样「投递成功」，
   * 页面却是旧的。现统一走 `SshExecService`（未登记主机 / 私钥缺失 → 抛错，不回落本机）。
   */
  async resolveTarget(env: string): Promise<RemoteTarget> {
    const t = await this.sshExec.resolve(env);
    return { remoteHost: t.host, remoteUser: t.username };
  }

  /** 阶段超时（env 覆盖，非法值回落默认） */
  private timeoutMs(stage: keyof typeof DELIVERY_TIMEOUT_MS): number {
    const key = `REMOTE_DELIVERY_${stage.toUpperCase()}_TIMEOUT_MS`;
    const raw = Number(this.configService.get<string>(key));
    return Number.isFinite(raw) && raw > 0 ? raw : DELIVERY_TIMEOUT_MS[stage];
  }

  /**
   * 远端静态产物根（诊断 #3 遗留：此前是 `release-paths.ts` 里的硬编码常量）。
   *
   * 为什么不能硬编码一条路径：prod 的静态根**不在** gateway 目录下
   * （实测 `/data/web_system_static/public`，与 dev 的
   * `/data/web_system/servers/gateway/public` 完全不同）。硬编码的那条只适用于
   * 与控制台同机同布局的环境 —— 换台机器就是「投递成功但页面 404」，且日志看不出来。
   *
   * 取值优先级（与 `apps/static-target.ts` 同口径，避免两处再漂移）：
   * 1. `REMOTE_MODULES_ROOT_<ENV>`（显式指定，最直白）
   * 2. `STATIC_PUBLIC_ROOT_<ENV>` + `/static/modules`（静态根已在 #3 按环境配置过）
   * 3. 旧常量（保持既有行为，未配置时不会突然改投递落点）
   */
  /** 委派给纯函数实现（同一入口，避免脚本变量与投递执行体各算一遍） */
  remoteModulesRoot(env: string): string {
    return resolveRemoteModulesRoot((k) => this.configService.get<string>(k), env);
  }

  /**
   * 远程投递 dist 产物：tar → scp → ssh 解压到远端
   * `<远端静态产物根>/<moduleKey>/<version>`，返回远端目标（供日志/result）。
   */
  async uploadDist(input: { env: string; moduleKey: string; version: string; srcDir: string }): Promise<RemoteDeliveryResult> {
    // `user@host` 的拼法复用脚本变量那一份（同一个 helper），避免投递执行体与脚本变量两种写法
    const { target: sshTarget } = toRemoteScriptSsh(await this.sshExec.resolve(input.env));
    const dest = `${this.remoteModulesRoot(input.env)}/${input.moduleKey}/${input.version}`;
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

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CommandService } from '../shell/command.service';
import { defaultReleaseWorkspace } from '../pipeline/release-paths';
import {
  entryPointerCss,
  entryPointerJs,
  envArtifactsDir,
  listEnvVersions,
  parsePointerVersion,
  readEnvEntryPointer,
  writeEnvEntryPointer,
} from './entry-pointer';
import {
  StaticTarget,
  describeTarget as describeStaticTarget,
  envArtifactsRel,
  resolveStaticTarget,
  sshPrefix,
} from './static-target';

/** 远端命令整体超时（毫秒）：列目录 / 校验 / 写指针都在 HTTP 请求路径上 */
const REMOTE_TIMEOUT_MS = 15_000;

export interface PointerWriteResult {
  js: string;
  css: string | null;
}

/**
 * 环境产物读写（**唯一落点决策者**，诊断 #3）
 *
 * console 本机不一定是该环境的产物所在机器 —— prod 的静态根外置在 prod 机上
 * （`/data/web_system_static/public`），写指针 / 校验产物都必须到**那台机器**上做。
 *
 * 两条实现：
 * - 本机（`sshTarget=null`）→ 直接 fs（入口指针格式仍只有 entry-pointer.ts 一处实现）
 * - 远端 → `ssh … bash`（脚本 base64 传递，避免多层引号转义踩坑）
 *
 * 失败语义：
 * - 读类（列版本 / 读指针）：远端不可达 → 降级空值 + 告警（页面可用，只是列表为空）
 * - 校验（切版本前）：远端不可达 → **抛错**（不能让「没校验」伪装成「校验通过」）
 */
@Injectable()
export class EnvArtifactService {
  private readonly logger = new Logger(EnvArtifactService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly command: CommandService,
  ) {}

  private get workspace(): string {
    return this.configService.get<string>('RELEASE_WORKSPACE') || defaultReleaseWorkspace();
  }

  /** 某环境的静态落点（配置驱动，未配置回落本机发布目录） */
  target(env: string): StaticTarget {
    return resolveStaticTarget(env, (k) => this.configService.get<string>(k), this.workspace);
  }

  /** 落点的人类可读描述（报错文案 / 排障用） */
  describeTarget(env: string): string {
    return describeStaticTarget(this.target(env));
  }

  /** 某版本产物是否就绪（入口文件存在） */
  async hasVersion(env: string, appKey: string, version: string): Promise<boolean> {
    const t = this.target(env);
    if (!t.sshTarget) {
      return fs.existsSync(
        path.join(envArtifactsDir(t.root, appKey, env), version, 'index.js'),
      );
    }
    const abs = `${t.root}/${path.posix.join(envArtifactsRel(appKey, env), version, 'index.js')}`;
    const r = await this.command.execAsync(
      `${sshPrefix(t.sshTarget)} "test -f '${abs}'"`,
      process.cwd(),
      {},
      REMOTE_TIMEOUT_MS,
    );
    return r.ok;
  }

  /** 该环境的可用版本（mtime 倒序）；远端不可达返回空数组 */
  async listVersions(env: string, appKey: string): Promise<string[]> {
    const t = this.target(env);
    if (!t.sshTarget) return listEnvVersions(t.root, appKey, env);
    const script = [
      `cd '${t.root}/${envArtifactsRel(appKey, env)}' 2>/dev/null || exit 0`,
      // -mindepth 2：跳过环境目录下的 index.js 指针本身，只取版本目录
      `find . -mindepth 2 -maxdepth 3 -name index.js -printf '%T@\\t%h\\n' | sort -rn | cut -f2- | sed 's|^\\./||'`,
      '',
    ].join('\n');
    const r = await this.command.execAsync(
      `${sshPrefix(t.sshTarget)} "echo ${b64(script)} | base64 -d | bash"`,
      process.cwd(),
      {},
      REMOTE_TIMEOUT_MS,
    );
    if (!r.ok) {
      this.logger.warn(
        `列远端产物版本失败（${describeStaticTarget(t)} ${appKey}@${env}）：${r.stderr}`,
      );
      return [];
    }
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /** 读回磁盘入口指针当前指向（展示 / 排障用；读不到返回 null） */
  async readPointer(env: string, appKey: string): Promise<string | null> {
    const t = this.target(env);
    if (!t.sshTarget) return readEnvEntryPointer(t.root, appKey, env);
    const rel = path.posix.join(envArtifactsRel(appKey, env), 'index.js');
    const r = await this.command.execAsync(
      `${sshPrefix(t.sshTarget)} "cat '${t.root}/${rel}' 2>/dev/null"`,
      process.cwd(),
      {},
      REMOTE_TIMEOUT_MS,
    );
    if (!r.ok) return null;
    return parsePointerVersion(r.stdout);
  }

  /**
   * 改写入口指针（切换版本 / 回滚的磁盘写入口）。
   * 远端场景一次 ssh 完成「备份 → 写 js → 有 css 则写 css」，失败抛错由调用方补偿。
   */
  async writePointer(
    env: string,
    appKey: string,
    version: string,
  ): Promise<PointerWriteResult> {
    const t = this.target(env);
    if (!t.sshTarget) return writeEnvEntryPointer(t.root, appKey, env, version);

    const dir = `${t.root}/${envArtifactsRel(appKey, env)}`;
    const script = [
      `set -e`,
      `mkdir -p '${dir}'`,
      `for f in index.js index.css; do`,
      `  [ -f '${dir}/$f' ] && cp -f '${dir}/$f' '${dir}/$f.bak-'$(date +%s) || true`,
      `done`,
      `cat > '${dir}/index.js' <<'WS_EOF'`,
      entryPointerJs(version).trimEnd(),
      `WS_EOF`,
      `if [ -f '${dir}/${version}/index.css' ]; then`,
      `  cat > '${dir}/index.css' <<'WS_EOF'`,
      entryPointerCss(version).trimEnd(),
      `WS_EOF`,
      `  echo WS_HAS_CSS`,
      `fi`,
      '',
    ].join('\n');
    const r = await this.command.execAsync(
      `${sshPrefix(t.sshTarget)} "echo ${b64(script)} | base64 -d | bash"`,
      process.cwd(),
      {},
      REMOTE_TIMEOUT_MS,
    );
    if (!r.ok) {
      throw new Error(
        `远端写入口指针失败（${describeStaticTarget(t)}）：${r.stderr || r.stdout}`,
      );
    }
    return {
      js: `${dir}/index.js`,
      css: r.stdout.includes('WS_HAS_CSS') ? `${dir}/index.css` : null,
    };
  }
}

/** base64（远端脚本传递用，避免多层引号转义） */
function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { CommandService } from '../shell/command.service';
import {
  cdnAppDir,
  cdnAssetDir,
  cdnLayoutMode,
  defaultReleaseWorkspace,
  resolveCdnTarget,
  toCommitId,
} from '../pipeline/release-paths';
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

  /** 配置读取器（`ConfigService.get<string>` 的形状，供纯函数使用） */
  private cfg = (key: string): string | undefined => this.configService.get<string>(key);

  /**
   * 是否处于 CDN 布局（Phase 2）。
   *
   * CDN 只覆盖**微前端产物（`index.js`）**；shell 基座（`index.html`）留在应用机
   * `TEMPLATE_ROOT`、不进 CDN（方案 §3.1），所以 CDN 分流只对 `entry === 'index.js'` 生效，
   * `index.html` 永远走 legacy 布局。
   */
  private isCdnLayout(): boolean {
    return cdnLayoutMode(this.cfg) === 'cdn';
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
  async hasVersion(
    env: string,
    appKey: string,
    version: string,
    entry: 'index.js' | 'index.html' = 'index.js',
  ): Promise<boolean> {
    // Phase 2：微前端（index.js）走入口机 `<env>/<app>/<commit>` 布局（去指针化，无磁盘指针）。
    // shell 基座（index.html）不进 CDN，仍走下方 legacy 布局。
    if (this.isCdnLayout() && entry === 'index.js') {
      const commit = toCommitId(version);
      if (!commit) return false;
      const t = resolveCdnTarget(this.cfg, env);
      const abs = `${cdnAssetDir(t.root, env, appKey, commit)}/index.js`;
      if (!t.sshTarget) return fs.existsSync(abs);
      const r = await this.command.execAsync(
        `${sshPrefix(t.sshTarget)} "test -f '${abs}'"`,
        process.cwd(),
        {},
        REMOTE_TIMEOUT_MS,
      );
      return r.ok;
    }

    const t = this.target(env);
    if (!t.sshTarget) {
      return fs.existsSync(
        path.join(envArtifactsDir(t.root, appKey, env), version, entry),
      );
    }
    const abs = `${t.root}/${path.posix.join(envArtifactsRel(appKey, env), version, entry)}`;
    const r = await this.command.execAsync(
      `${sshPrefix(t.sshTarget)} "test -f '${abs}'"`,
      process.cwd(),
      {},
      REMOTE_TIMEOUT_MS,
    );
    return r.ok;
  }

  /** 该环境的可用版本（mtime 倒序）；远端不可达返回空数组 */
  async listVersions(env: string, appKey: string, entry: 'index.js' | 'index.html' = 'index.js'): Promise<string[]> {
    // Phase 2：微前端（index.js）CDN 布局下，`<env>/<app>/` 的下一级直接是 commit 目录。
    if (this.isCdnLayout() && entry === 'index.js') {
      const t = resolveCdnTarget(this.cfg, env);
      const base = cdnAppDir(t.root, env, appKey);
      if (!t.sshTarget) return listCdnCommitDirs(base, entry);
      const script = [
        `cd '${base}' 2>/dev/null || exit 0`,
        // CDN 布局无命名空间二级，commit 目录直接含 index.js（mindepth 2 = <commit>/index.js）
        `find . -mindepth 2 -maxdepth 2 -name '${entry}' -printf '%T@\\t%h\\n' | sort -rn | cut -f2- | sed 's|^\\./||'`,
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
          `列远端 CDN 产物版本失败（${t.sshTarget}:${base} ${appKey}@${env}）：${r.stderr}`,
        );
        return [];
      }
      return r.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    }

    const t = this.target(env);
    if (!t.sshTarget) return listEnvVersions(t.root, appKey, env, entry);
    const script = [
      `cd '${t.root}/${envArtifactsRel(appKey, env)}' 2>/dev/null || exit 0`,
      // -mindepth 2：跳过环境目录下的 index.js 指针本身，只取版本目录
      `find . -mindepth 2 -maxdepth 3 -name '${entry}' -printf '%T@\\t%h\\n' | sort -rn | cut -f2- | sed 's|^\\./||'`,
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
    // Phase 2 去指针化：CDN 模式磁盘无指针，manifest 直接给完整 URL，读指针无意义。
    if (this.isCdnLayout()) return null;
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
    // Phase 2 去指针化：CDN 模式不存在磁盘指针可写（调用方 `AppsService` 已跳过此步）。
    // 这里 fail-fast 防误用，避免「以为写了指针、实际线上按 DB 直给 URL」的假成功。
    if (this.isCdnLayout()) {
      throw new Error('CDN 布局下不存在磁盘入口指针（去指针化），不应调用 writePointer');
    }
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

/**
 * CDN 布局下本机列出 commit 目录（mtime 倒序）。
 *
 * 与 legacy `listEnvVersions` 对齐但布局不同：`<base>/<commit>/<entry>`（一级即 commit，
 * 无命名空间二级）。仅在本机（`CDN_SSH_TARGET` 未配）时用，抽出便于单测。
 */
export function listCdnCommitDirs(base: string, entry: string): string[] {
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, entry)))
    .sort(
      (a, b) =>
        fs.statSync(path.join(base, b.name)).mtimeMs -
        fs.statSync(path.join(base, a.name)).mtimeMs,
    )
    .map((d) => d.name);
}

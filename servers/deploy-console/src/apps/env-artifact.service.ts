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

/**
 * 「入口不可解析」错误码前缀（台账 #9087）。
 *
 * 与「版本产物不存在」是两件事：后者是 `index.html` 本身缺失（旧行为已 fail-closed），
 * 前者是 `index.html` 在、但它引用的 js / css 在落点上不存在 —— 切过去就是**白屏**。
 * 验收脚本按这个字符串断言，别改成别的说法。
 */
export const ENTRY_UNRESOLVABLE = 'ENTRY_UNRESOLVABLE';

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
    // shell 基座（index.html）不进 CDN，仍走 legacy 布局。
    return (await this.resolveVersion(env, appKey, version, entry)) !== null;
  }

  /**
   * 入口引用可解析性校验（台账 #9087）。
   *
   * **为什么需要**：`hasVersion` 只判 `<version>/index.html` 存在。线上出现过
   * index.html 在、它引用的 `assets/*.js` 不在（`6e7b2690` / `4ea6d64` 指向
   * `/static/modules/shell/shell-dev/…`，prod 没有该目录）⇒ 切换成功、页面白屏。
   * 文件存在 ≠ 可服务，这一层把 fail-open 改成 fail-closed：**切不动，指针不动**。
   *
   * 只判 `.js` / `.css`（决定页面能否起来的那两个）；图片 404 不致白屏，不拦。
   * 非 `/static/` 的绝对路径（如 `/shell/…` 由 gateway 拼装）不属版本产物，跳过。
   * html 读不到 / ssh 不可达 → 抛错（不允许静默通过）；引用全可解析 → 静默返回。
   *
   * @throws Error 消息以 {@link ENTRY_UNRESOLVABLE} 开头（调用方转 400）
   */
  async assertArtifactResolvable(env: string, appKey: string, version: string): Promise<void> {
    const t = this.target(env);
    const dirName = await this.resolveVersion(env, appKey, version, 'index.html');
    if (!dirName) {
      throw new Error(
        `${ENTRY_UNRESOLVABLE}: 入口文件不存在：${appKey}/${env}/${version}/index.html（${describeStaticTarget(t)}）`,
      );
    }
    const versionDir = `${t.root}/${path.posix.join(envArtifactsRel(appKey, env), dirName)}`;
    const html = await this.readTextAt(t, `${versionDir}/index.html`);

    const refs = extractEntryAssetRefs(html);
    const probed: string[] = [];
    for (const ref of refs) {
      const abs = resolveEntryRefPath(t.root, versionDir, ref);
      if (abs && !probed.includes(abs)) probed.push(abs);
    }
    // 无可判定引用（纯内联脚本页面 / 全部为外链）：不阻断，避免误杀
    if (probed.length === 0) return;

    const missing = t.sshTarget
      ? await this.missingPathsOn(t.sshTarget, probed)
      : probed.filter((p) => !fs.existsSync(p));
    if (missing.length === 0) return;

    throw new Error(
      `${ENTRY_UNRESOLVABLE}: 入口引用的资源在落点上不存在，切过去会白屏：` +
        `${appKey}/${env}/${version}（${describeStaticTarget(t)}）缺 ${missing.join(', ')}`,
    );
  }

  /** 读落点上某个绝对路径的文本（本机 fs / 远端 cat）；读不到抛错，不降级 */
  private async readTextAt(t: StaticTarget, abs: string): Promise<string> {
    if (!t.sshTarget) {
      try {
        return fs.readFileSync(abs, 'utf8');
      } catch (e) {
        throw new Error(`入口文件读取失败（${describeStaticTarget(t)} ${abs}）：${(e as Error).message}`);
      }
    }
    const r = await this.command.execAsync(
      `${sshPrefix(t.sshTarget)} "cat '${abs}'"`,
      process.cwd(),
      {},
      REMOTE_TIMEOUT_MS,
    );
    if (!r.ok) {
      throw new Error(
        `入口文件读取失败（${describeStaticTarget(t)} ${abs}）：${r.stderr || r.stdout}`,
      );
    }
    return r.stdout;
  }

  /**
   * 远端批量存在性判定（**一条 ssh**，不逐文件往返）。
   * @returns 不存在的绝对路径（按传参顺序）
   */
  private async missingPathsOn(sshTarget: string, paths: string[]): Promise<string[]> {
    // 路径含单引号会破坏 shell 单引号包裹：这类路径本不该出现，直接视为不可判定跳过
    const safe = paths.filter((p) => !p.includes("'"));
    if (safe.length === 0) return [];
    const script = [...safe.map((p) => `[ -e '${p}' ] || echo '${p}'`), ''].join('\n');
    const r = await this.command.execAsync(
      `${sshPrefix(sshTarget)} "echo ${b64(script)} | base64 -d | bash"`,
      process.cwd(),
      {},
      REMOTE_TIMEOUT_MS,
    );
    if (!r.ok) {
      throw new Error(
        `入口资源校验失败（无法访问 ${sshTarget}）：${r.stderr || r.stdout}`,
      );
    }
    return r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  }

  /**
   * 版本在落点上的**实际目录名**（台账 #9027 核验修正）。
   *
   * legacy 布局磁盘是 `<app>/<env>/<version>`，历史上有两种拼写：
   * - 干净值：纯 commit（`b6ec9950`）
   * - 脏值：`<templateKey>/<commit>`（`portal/b6ec9950`，`deploy_app_env_versions` 的存量）
   *
   * 取候选顺序 **原始值 → `toCommitId` 归一值**：
   * - 原始值优先，保住流水线命名空间目录（`default/<commit>`）等既有可用路径，零回归；
   * - 归一值兜底，让「DB 里还留着 `portal/b6ec9950`」的回滚 / 指针修复不再落空。
   * CDN 布局本来就只用 `toCommitId`，两边口径一致。
   *
   * @returns 命中的版本目录名；都不存在返回 null
   */
  async resolveVersion(
    env: string,
    appKey: string,
    version: string,
    entry: 'index.js' | 'index.html' = 'index.js',
  ): Promise<string | null> {
    if (this.isCdnLayout() && entry === 'index.js') {
      const commit = toCommitId(version);
      if (!commit) return null;
      const t = resolveCdnTarget(this.cfg, env);
      return (await this.existsAtCdn(t, env, appKey, commit)) ? commit : null;
    }

    const t = this.target(env);
    for (const v of legacyVersionCandidates(version)) {
      if (await this.existsAtLegacy(t, appKey, env, v, entry)) return v;
    }
    return null;
  }

  /** legacy 落点的存在性探活（本机 fs / 远端 test -f） */
  private async existsAtLegacy(
    t: StaticTarget,
    appKey: string,
    env: string,
    version: string,
    entry: string,
  ): Promise<boolean> {
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

  /** CDN 落点的存在性探活（本机 fs / 远端 test -f） */
  private async existsAtCdn(
    t: { root: string; sshTarget: string | null },
    env: string,
    appKey: string,
    commit: string,
  ): Promise<boolean> {
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
    // 历史脏值（DB 里 `portal/b6ec9950`）→ 落到磁盘实际目录名；
    // 否则指针会写成 `./portal/b6ec9950/index.js` 指向一个不存在的目录（回滚静默失效）。
    const target = (await this.resolveVersion(env, appKey, version)) ?? version;
    if (!t.sshTarget) return writeEnvEntryPointer(t.root, appKey, env, target);

    const dir = `${t.root}/${envArtifactsRel(appKey, env)}`;
    const script = [
      `set -e`,
      `mkdir -p '${dir}'`,
      `for f in index.js index.css; do`,
      `  [ -f '${dir}/$f' ] && cp -f '${dir}/$f' '${dir}/$f.bak-'$(date +%s) || true`,
      `done`,
      `cat > '${dir}/index.js' <<'WS_EOF'`,
      entryPointerJs(target).trimEnd(),
      `WS_EOF`,
      `if [ -f '${dir}/${target}/index.css' ]; then`,
      `  cat > '${dir}/index.css' <<'WS_EOF'`,
      entryPointerCss(target).trimEnd(),
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
 * 从 `index.html` 抽出「决定页面能否起来」的资源引用（台账 #9087）。
 *
 * 规则（每条都为了不误杀）：
 * - 只看 `src=` / `href=`；只留 `.js` / `.css` 结尾（图片、字体 404 不致白屏）
 * - 去掉 query / hash 再判后缀（`index.js?v=2` 常见于构建产物）
 * - 跳过带协议的（`http(s):` / `data:` / `mailto:`）、协议相对（`//`）、锚点（`#`）
 * - 去重保序（同一份 index.html 里 preload 与 script 常指向同一文件）
 */
export function extractEntryAssetRefs(html: string): string[] {
  const out: string[] = [];
  const re = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] ?? m[2] ?? '').trim();
    if (!raw) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue;
    const clean = raw.split(/[?#]/)[0].trim();
    if (!/\.(?:js|css)$/i.test(clean)) continue;
    if (!out.includes(clean)) out.push(clean);
  }
  return out;
}

/**
 * 入口引用 → 落点上的磁盘绝对路径（台账 #9087）。返回 null 表示**不判定**。
 *
 * - `/static/…`：本站静态根下的绝对路径 → `<root>/static/…`
 *   （跨环境引用 `…/shell/shell-dev/…` 正是白屏成因，必须落到同一台落点机上判）
 * - 其他 `/…`：`/shell/…` 之类由 gateway 自行拼装，不属版本产物 → 跳过（不误杀）
 * - 相对路径：相对版本目录；`normalize` 后越出版本目录（`../`）→ 跳过
 */
export function resolveEntryRefPath(
  root: string,
  versionDir: string,
  ref: string,
): string | null {
  const clean = (ref ?? '').split(/[?#]/)[0].trim();
  if (!clean) return null;
  const base = root.replace(/\/+$/, '');
  if (clean.startsWith('/static/')) {
    const abs = path.posix.normalize(`${base}${clean}`);
    return abs.startsWith(`${base}/static/`) ? abs : null;
  }
  if (clean.startsWith('/')) return null;
  const abs = path.posix.normalize(path.posix.join(versionDir, clean));
  return abs.startsWith(`${versionDir.replace(/\/+$/, '')}/`) ? abs : null;
}

/**
 * legacy 版本目录的候选名（台账 #9027 核验修正）。
 *
 * 顺序即优先级：**原始值在前**（保住流水线命名空间 `default/<commit>` 等既有目录，
 * 零回归），`toCommitId` 归一值兜底（救 DB 里的 `<templateKey>/<commit>` 脏值）。
 * 含空段 / `.` / `..` 的候选直接丢弃，避免拼出越界路径。
 */
export function legacyVersionCandidates(version: string): string[] {
  const out: string[] = [];
  const add = (v: string | undefined) => {
    if (!v) return;
    const segs = v.split('/');
    if (segs.some((s) => !s || s === '.' || s === '..')) return;
    if (!out.includes(v)) out.push(v);
  };
  add((version ?? '').trim());
  add(toCommitId(version));
  return out;
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

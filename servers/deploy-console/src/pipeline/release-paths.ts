import * as path from 'path';
import * as os from 'os';

/**
 * 默认发布目录（`RELEASE_WORKSPACE` 未配置时回落）。
 * 取当前用户主目录下的 web_system_release，不绑定任何具体机器/用户名。
 */
export function defaultReleaseWorkspace(): string {
  return path.join(os.homedir(), 'web_system_release');
}

/**
 * 静态产物路径工具（纯函数，便于单测）。
 *
 * 发布平台「产物在哪个目录、HTTP URL 是什么、远端投到哪」这类平台知识，
 * 此前散落在 pipeline.service.ts 多处手拼（hasArtifact / listArtifactVersions /
 * switchPointer / stageUpload / stageCleanup / stageVerify），改布局只漏改一处就会
 * 出现「投递成功但验证 404」这类静默问题。统一收口到本文件（V6 平台逻辑收敛为工具）。
 */

/** 发布目录内 gateway 静态产物相对布局（与本地发布目录 / 远程部署目录布局一致） */
export const STATIC_MODULES_REL = 'servers/gateway/public/static/modules';

/**
 * 远程服务器投递根目录（scp 目标，与发布目录布局一致）——**仅作未配置时的回落**。
 *
 * 诊断 #3 遗留：这条路径只适用于「与控制台同机同布局」的环境（dev 那种）。
 * prod 的静态根是 `/data/web_system_static/public`（完全不同），
 * 因此真正的取值在 `RemoteDeliveryService.remoteModulesRoot(env)`：
 * `REMOTE_MODULES_ROOT_<ENV>` → `STATIC_PUBLIC_ROOT_<ENV>` + /static/modules → 本常量。
 */
export const REMOTE_MODULES_ROOT = '/data/web_system/servers/gateway/public/static/modules';

/** 发布目录（本地 fs）中某模块产物根目录 */
export function moduleArtifactsRoot(releaseWorkspace: string, moduleKey: string): string {
  return path.join(releaseWorkspace, STATIC_MODULES_REL, moduleKey);
}

/** 指定版本的产物目录（本地 fs）；version 可含 `/`（`<pipelineKey>/<commit>` 命名空间） */
export function moduleArtifactDir(
  releaseWorkspace: string,
  moduleKey: string,
  version: string,
): string {
  return path.join(moduleArtifactsRoot(releaseWorkspace, moduleKey), version);
}

/** 产物入口文件绝对路径（index.js），用于磁盘存在性断言 */
export function moduleArtifactEntry(
  releaseWorkspace: string,
  moduleKey: string,
  version: string,
): string {
  return path.join(moduleArtifactDir(releaseWorkspace, moduleKey, version), 'index.js');
}

// ── M2：部署目标推导（2026-09-17）────────────────────────────
// 设计见 specs/deploy-console/artifact-path-and-deploy-model.md：
// 部署位置是**模块的自有属性**（deployRoot），环境只决定"产物落在产物区的哪一层"，
// 不再需要为每个环境配 3 套 PUBLISH_PATH / HOST / USER 变量。

/** 产物区：流水线投递到这里，**不直接生效** */
export function artifactsDir(releaseWorkspace: string, moduleKey: string, env: string, version: string): string {
  return path.join(releaseWorkspace, 'artifacts', moduleKey, env, version);
}

/** 部署根：模块自持（相对发布目录根） */
export function deployRootAbs(releaseWorkspace: string, deployRoot?: string): string {
  return deployRoot ? path.join(releaseWorkspace, deployRoot) : releaseWorkspace;
}

/**
 * 部署目标的绝对路径：`<ws>/<deployRoot>`，默认产物路径拼在其后（后台为 `dist`）。
 * 未配 deployRoot 时返回空串 —— 调用方应回退到旧的流水线变量（双轨，零破坏）。
 */
export function deployTargetAbs(
  releaseWorkspace: string,
  deployRoot?: string,
  defaultArtifactPath?: string | null,
): string {
  if (!deployRoot) return '';
  const root = deployRootAbs(releaseWorkspace, deployRoot);
  const sub = (defaultArtifactPath || '').replace(/^\/+|\/+$/g, '');
  return sub ? path.join(root, sub) : root;
}

/** 产物 HTTP URL（gateway 静态服务可访问地址，verify 阶段 HEAD 探活用） */
export function moduleArtifactUrl(gatewayBaseUrl: string, moduleKey: string, version: string): string {
  return `${gatewayBaseUrl}/static/modules/${moduleKey}/${version}/index.js`;
}

/** gateway 模块清单 URL（verify 阶段断言版本已生效） */
export function manifestUrl(gatewayBaseUrl: string): string {
  return `${gatewayBaseUrl}/__manifest__`;
}

// ── R6 版本身份（design.md §3.1 D-a）─────────────────────────

/** 版本引用解析结果 */
export interface ReleaseRef {
  /** 流水线 key（无 `/` 前缀 = legacy 历史版本） */
  pipelineKey?: string;
  /** 版本号（git 短哈希） */
  version: string;
}

/**
 * 解析版本引用（**唯一解析点**，design.md §3.1 §7.3）。
 *
 * - `default/1a2b3c4` → `{ pipelineKey: 'default', version: '1a2b3c4' }`（流水线命名空间）
 * - `1a2b3c4`         → `{ version: '1a2b3c4' }`（legacy 历史产物）
 *
 * 产物目录 = `modules/<module>/<完整引用>/`，`current_version` = 完整引用。
 * gateway / nginx 零改动（gateway 只做字符串拼接，version 含 `/` 即多一级目录）。
 */
export function parseReleaseRef(ref: string): ReleaseRef {
  const idx = ref.indexOf('/');
  if (idx < 0) return { version: ref };
  const pipelineKey = ref.slice(0, idx);
  const version = ref.slice(idx + 1);
  if (!pipelineKey || !version) return { version: ref };
  return { pipelineKey, version };
}

/** 组装版本引用（`<pipelineKey>/<version>` 或纯 `<version>`） */
export function buildReleaseRef(pipelineKey: string | undefined, version: string): string {
  return pipelineKey ? `${pipelineKey}/${version}` : version;
}

/**
 * 从版本引用取**纯 commit**（`SubmitPipelineDto.commitId` 的归一化入口）。
 *
 * 背景：控制台「Commit」下拉的数据来自版本列表（`/pipelines/meta/releases`），
 * 而版本引用是**完整引用**（`<templateKey>/<commit>`，如 `default/1a2b3c4`）；
 * 提交接口按「纯短哈希」设计（白名单 `^[A-Za-z0-9._-]{4,64}$`，`/` 非法）——
 * 直接透传就会出现「目标 commit 含非法字符: default/1a2b3c4」400（线上已复现）。
 *
 * 故在入口统一归一化：完整引用取末段，纯 commit 原样返回；空值返回 undefined（=分支最新）。
 */
export function toCommitId(ref?: string | null): string | undefined {
  const v = (ref ?? '').trim();
  if (!v) return undefined;
  return parseReleaseRef(v).version;
}

// ── Phase 2：CDN 布局（`<env>/<app>/<commit>`）─────────────────
// 设计见 specs/static-cdn-phase2/design.md。
//
// 为什么单独长出一层：Phase 2 把落点从「应用机 gateway 静态根」搬到「入口机 /data/cdn」，
// 且目录顺序由 `<app>/<env>` **互换**为 `<env>/<app>`。顺序互换不是改名——只换根不换顺序时，
// GC 扫到的下一级恰好是 commit 哈希，能通过 `isSafeVersionName` 真删成功（静默删错目录）。
// 故所有路径必须经下面这组函数产出，禁止任何调用方再手拼字符串。
//
// 默认零变化：未设 `CDN_LAYOUT_MODE=cdn` 时，这些函数不参与任何存量路径计算。

/** 入口机 CDN 根（磁盘绝对路径）；可用 `CDN_ROOT` / `CDN_ROOT_<ENV>` 覆盖 */
export const CDN_ROOT = '/data/cdn';

/** 单段白名单（与 commit 白名单同口径，避免 `/` 进入路径） */
export const CDN_SEGMENT_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** 路径段是否安全（空 / `.` / `..` / 含 `/` 或空格一律 false） */
export function isSafeSegment(s: string | null | undefined): boolean {
  const v = (s ?? '').trim();
  if (!v || v === '.' || v === '..') return false;
  return CDN_SEGMENT_RE.test(v);
}

function assertSegment(kind: string, s: string | null | undefined): string {
  const v = (s ?? '').trim();
  if (!isSafeSegment(v)) {
    throw new Error(`CDN 路径段非法（${kind}）: ${JSON.stringify(s ?? '')}`);
  }
  return v;
}

/** 相对文件路径（允许 `chunks/x.js` 这样的子路径，但每段都要安全） */
function assertRelFile(file: string): string {
  const segs = (file ?? '').split('/').filter((x) => x !== '');
  if (!segs.length) throw new Error('CDN 文件名为空');
  for (const s of segs) assertSegment('file', s);
  return segs.join('/');
}

function trimSlash(s: string): string {
  return (s ?? '').trim().replace(/\/+$/, '');
}

/**
 * 资产目录（入口机磁盘，posix 分隔符 —— 远端 shell 用）。
 * `/data/cdn/<env>/<app>`
 *
 * 与 {@link cdnAssetDir} 分开是因为「清理」只看 app 层（其下才是 commit 目录），
 * 而投递/校验要到 commit 层。两者必须共用同一顺序，故 cdnAssetDir 复用它。
 */
export function cdnAppDir(
  root: string | null | undefined,
  env: string,
  app: string,
): string {
  const base = trimSlash(root || CDN_ROOT) || CDN_ROOT;
  return `${base}/${assertSegment('env', env)}/${assertSegment('app', app)}`;
}

/** 某个 commit 的产物目录：`<root>/<env>/<app>/<commit>`（复用 cdnAppDir，顺序只此一处） */
export function cdnAssetDir(
  root: string | null | undefined,
  env: string,
  app: string,
  commit: string,
): string {
  return `${cdnAppDir(root, env, app)}/${assertSegment('commit', commit)}`;
}

/**
 * 资产 HTTP URL（verify 阶段 200 + sha256 探活用）。
 * `<origin>/<env>/<app>/<commit>/<file>`；`origin` 是**带域名的完整 URL base**（如 `https://kedouai.com/cdn`）。
 */
export function cdnAssetUrl(
  origin: string,
  env: string,
  app: string,
  commit: string,
  file = 'index.js',
): string {
  const base = trimSlash(origin);
  if (!base) throw new Error('cdnAssetUrl: origin 为空（需完整 URL base）');
  return `${base}/${assertSegment('env', env)}/${assertSegment('app', app)}/${assertSegment('commit', commit)}/${assertRelFile(file)}`;
}

/** 公共依赖 URL：`<origin>/common/{libs,pub}/<file>` */
export function cdnCommonUrl(
  origin: string,
  group: 'libs' | 'pub',
  file: string,
): string {
  const base = trimSlash(origin);
  if (!base) throw new Error('cdnCommonUrl: origin 为空（需完整 URL base）');
  if (group !== 'libs' && group !== 'pub') {
    throw new Error(`cdnCommonUrl: 未知分组 ${JSON.stringify(group)}（只接受 libs / pub）`);
  }
  return `${base}/common/${group}/${assertRelFile(file)}`;
}

// ── 落点解析（投递 / 校验 / GC 同源）────────────────────────

/** 配置读取器（`ConfigService.get<string>` 的形状；抽出来便于纯函数单测） */
export type CdnConfigGetter = (key: string) => string | undefined;

/** 环境 → 配置键后缀（`staging-1` → `STAGING_1`） */
function envSuffix(env: string): string {
  return (env || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export interface CdnTarget {
  env: string;
  /** 入口机 CDN 根（磁盘绝对路径） */
  root: string;
  /** ssh 目标 `user@host`；null = 控制台本机 */
  sshTarget: string | null;
}

/**
 * 唯一落点解析（**P0**）。
 *
 * 历史上 `staticRootOf()` 取 `STATIC_PUBLIC_ROOT_<ENV>`，而 `rm -rf` 走 `ssh.run(env)`
 * （`SshExecService.resolve` 另算一份目标机）——两套独立配置，于是「路径算在一处、删除执行在另一处」。
 * Phase 2 收口为**一个函数同时返回 root 与 sshTarget**，投递 / verify / GC 全部调它，
 * 从结构上消灭这份重复推导。
 */
export function resolveCdnTarget(get: CdnConfigGetter, env: string): CdnTarget {
  const e = envSuffix(env);
  const root =
    trimSlash(get(`CDN_ROOT_${e}`) || '') || trimSlash(get('CDN_ROOT') || '') || CDN_ROOT;
  const ssh = (get(`CDN_SSH_TARGET_${e}`) || get('CDN_SSH_TARGET') || '').trim();
  return { env, root, sshTarget: ssh || null };
}

/** 布局开关：`legacy`（默认，逐字节零变化）/ `cdn`（Phase 2 新布局） */
export type CdnLayoutMode = 'legacy' | 'cdn';

/**
 * 读布局开关。取值非法直接 throw —— 拼错成 `cnd` 时静默回退 legacy 会让
 * 「以为已切新布局、实际按旧布局投递」变成不可见的假成功。
 */
export function cdnLayoutMode(get: CdnConfigGetter): CdnLayoutMode {
  const raw = (get('CDN_LAYOUT_MODE') || '').trim().toLowerCase();
  if (!raw || raw === 'legacy') return 'legacy';
  if (raw === 'cdn') return 'cdn';
  throw new Error(`CDN_LAYOUT_MODE 取值非法: ${JSON.stringify(raw)}（只接受 legacy / cdn）`);
}

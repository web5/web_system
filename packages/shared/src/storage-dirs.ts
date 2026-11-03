import * as nodePath from 'path';
import type { DeployMode } from './deploy-mode';
import {
  ensureWritableDir,
  resolveStorageDirsAtStartup,
  resolveUploadDirAtStartup,
} from './storage-dir';
import type { FetchConfiguredDirOptions, StorageDirSource } from './storage-dir';

/**
 * 存储目录的**进程内持有者**（启动期由各服务的 provider 注入一次）。
 *
 * ## 为什么需要它（而不是到处 `@Inject`）
 *
 * 有两类调用点拿不到 DI，也拿不到 `this`：
 * 1. **装饰器求值期**：user-service 的 `FileInterceptor` 里 Multer 的 `destination`
 *    回调在**请求时**执行，此刻没有容器上下文可用；
 * 2. **`main.ts` 的静态资源挂载**：`app.useStaticAssets()` 在 `NestFactory.create`
 *    之后、`listen` 之前，可以 `app.get(STORAGE_DIRS)`，但那要求模块一定被引入 ——
 *    持有者让「有没有解析过」这件事可显式断言（`getStorageDirs()` 未初始化就抛）。
 *
 * 与 `dataDir()`（standalone 单机口径）的关系：**cluster 形态下请一律走这里**。
 * `dataDir()` 只是「运行根 + 段名」的拼接，不区分形态、不查系统表 —— 它仍在
 * 单机/私有化场景使用，但在集群里用它就是漂移的来源。
 *
 * ## 语义：进程常量
 *
 * 目录对进程是**常量**（重启才可能变）。运行期改系统配置不会切换目录 ——
 * 与「已保存未重启」的权威配置值区分开（系统设置页面展示的就是这一对值）。
 */

/** DI token：启动期解析出的存储目录集合（各服务在自己的 module 里 provide） */
export const STORAGE_DIRS = 'STORAGE_DIRS';

export interface ResolvedStorageDirs {
  /** 上传根目录绝对路径 */
  uploadDir: string;
  /**
   * 临时图目录绝对路径；`null` = 本服务不需要临时图目录（只解析了上传根目录）。
   *
   * 为什么允许 null：user-service 只用 uploads/avatars，硬要它解析 temp
   * 等于把「temp 配置出问题」变成「用户服务起不来」的无谓耦合。
   */
  tempDir: string | null;
  /** 两个目录各自经哪一级取得（cluster 下都是 `system_service`） */
  uploadSource: StorageDirSource;
  tempSource: StorageDirSource | null;
  /** 本次生效的部署形态 —— 回答「为什么走了这条链」 */
  mode: DeployMode;
  /** 过程性说明（形态判定依据 + 解析过程），启动期应打日志 */
  notes: string[];
}

let current: ResolvedStorageDirs | null = null;

/** 由启动期的 provider 注入一次（重复调用以最后一次为准，正常只会调一次） */
export function setResolvedStorageDirs(dirs: ResolvedStorageDirs): void {
  current = {
    ...dirs,
    uploadDir: nodePath.resolve(dirs.uploadDir),
    tempDir: dirs.tempDir ? nodePath.resolve(dirs.tempDir) : null,
  };
}

/**
 * 取解析结果；**未初始化就抛错** —— 绝不静默回落到 cwd。
 *
 * 抛错而不是给默认值，是因为「用错目录」的代价远大于「起不来」：
 * 文件上传到 `/root/web_system/uploads` 这种分裂目录，要很久才会被发现。
 */
export function getStorageDirs(): ResolvedStorageDirs {
  if (!current) {
    throw new Error(
      '存储目录尚未初始化：应由服务内 StorageDirsModule 的 STORAGE_DIRS provider 在启动时注入' +
        '（见 packages/shared/src/storage-dirs.ts）',
    );
  }
  return current;
}

/** 上传根目录（未初始化抛错） */
export function getUploadDir(): string {
  return getStorageDirs().uploadDir;
}

/** 临时图目录（未初始化、或本服务没解析 temp → 抛错） */
export function getTempDir(): string {
  const dirs = getStorageDirs();
  if (!dirs.tempDir) {
    throw new Error(
      '本服务未启用临时图目录（启动期只解析了上传根目录）：' +
        '需要的话请在调用 resolveAndHoldStorageDirs 时传 { withTempDir: true }',
    );
  }
  return dirs.tempDir;
}

/** 是否已初始化（仅用于诊断/测试，不参与业务） */
export function hasStorageDirs(): boolean {
  return current !== null;
}

/** 仅测试用：清空持有者 */
export function resetStorageDirsForTest(): void {
  current = null;
}

/* ── 启动期解析入口（供各服务的 module provider 调用） ───────────── */

/**
 * 解析 → 目录自检 → 写入持有者，**一次做完**。
 *
 * 为什么合并成一个入口：这三步必须一起发生。分开写就会出现「解析了但没 ensureDir」
 * 或「ensureDir 了但没写进持有者」—— 后者最隐蔽：进程能起来，请求时才抛「尚未初始化」。
 *
 * @param withTempDir 本服务是否需要临时图目录（ai-service 需要，user-service 不需要）
 * @throws 解析失败 / 目录不可写 —— 调用方应 fail-fast（打日志后 process.exit(1)）
 */
export async function resolveAndHoldStorageDirs(
  options: { withTempDir?: boolean; env?: NodeJS.ProcessEnv } & FetchConfiguredDirOptions = {},
): Promise<ResolvedStorageDirs> {
  const { withTempDir = false, ...fetchOpts } = options;
  const notes: string[] = [];

  if (withTempDir) {
    const { upload, temp } = await resolveStorageDirsAtStartup(fetchOpts);
    ensureWritableDir(upload.dir);
    ensureWritableDir(temp.dir);
    notes.push(...upload.notes, ...temp.notes);
    const dirs: ResolvedStorageDirs = {
      uploadDir: upload.dir,
      tempDir: temp.dir,
      uploadSource: upload.source,
      tempSource: temp.source,
      mode: upload.mode,
      notes,
    };
    setResolvedStorageDirs(dirs);
    return dirs;
  }

  const upload = await resolveUploadDirAtStartup(fetchOpts);
  ensureWritableDir(upload.dir);
  notes.push(...upload.notes);
  const dirs: ResolvedStorageDirs = {
    uploadDir: upload.dir,
    tempDir: null,
    uploadSource: upload.source,
    tempSource: null,
    mode: upload.mode,
    notes,
  };
  setResolvedStorageDirs(dirs);
  return dirs;
}

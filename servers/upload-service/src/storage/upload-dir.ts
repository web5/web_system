/**
 * 上传根目录解析 —— **实现已上提到 `@web-system/shared`**，本文件只做转发。
 *
 * 为什么要上提：ai-service / user-service 也要解析 uploads、temp-images。
 * 若各自抄一份就是第三、第四套实现，判据一改就要改 N 处，必然漂移。
 *
 * 行为变化（2026-11-03，形态分派）：
 * - 新增 `DEPLOY_MODE=cluster|standalone` 判定（未声明默认 cluster，与现状一致）
 * - **cluster 形态下系统配置表是唯一权威**：拿不到 / 权威源在用默认值 → 拒绝启动，
 *   不再回落到单机默认路径（旧行为会让集群全员静默改用 `~/web_system/uploads`，数据分裂）
 * - standalone 形态完全绕开系统表（配了内部密钥也不发请求）
 *
 * 单测随实现一起搬到 `packages/shared/src/storage-dir.spec.ts`（21 条，含原 15 条断言）。
 */
export {
  DEFAULT_STORAGE_BASE,
  DEFAULT_UPLOAD_DIR,
  INTERNAL_API_KEY_ENV,
  STORAGE_ALLOWED_ROOTS_ENV,
  STORAGE_UPLOAD_DIR_ENV,
  STORAGE_UPLOAD_DIR_KEY,
  SYSTEM_SERVICE_URL_ENV,
  UPLOAD_DIR_SPEC,
  WEB_SYSTEM_DIR_ENV,
  allowedRoots,
  describePathError,
  ensureWritableDir,
  fetchConfiguredDir,
  resolveStorageDirAtStartup,
  resolveStorageDirInput,
  resolveUploadDirAtStartup,
} from '@web-system/shared';
export type {
  FetchConfiguredDirOptions,
  StorageDirResolution,
  StorageDirSource,
  StorageDirSpec,
} from '@web-system/shared';

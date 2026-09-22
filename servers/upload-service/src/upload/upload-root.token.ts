/**
 * DI token：**启动期解析出的上传根目录**（绝对路径字符串）。
 *
 * 由 `UploadModule` 的 provider 在启动时解析（查 system-service 配置 → env → 默认）
 * 并做 ensureDir + 可写性探测；不可用则 fail-fast，绝不静默回落 cwd。
 *
 * 之所以用 token 注入而不是让各处理器读 `process.env`：目录必须是**进程常量**，
 * 语义是「重启生效」，而不是「每次请求读一遍配置」。
 */
export const UPLOAD_ROOT = 'UPLOAD_ROOT_DIR';

import * as path from 'path';

/**
 * 上传根目录的**进程内持有者**（启动期由 `UploadModule` 的 provider 注入一次）。
 *
 * 为什么需要它：Multer 的配置在**装饰器求值时**就要给出（拿不到 `this`，也拿不到 DI），
 * 而上传根目录要到启动期查完系统配置才知道。于是把「解析」与「使用」拆开：
 * provider 在启动时解析并 `setUploadRoot()`，装饰器里的回调到**请求时**再 `getUploadRoot()`。
 *
 * 这同时保证了 design §1.2 的语义：目录对进程是**常量**（重启才可能变），
 * 运行期无论配置怎么改，本进程写的还是同一个目录。
 */
let currentRoot: string | null = null;
let currentSource: string | null = null;

export function setUploadRoot(dir: string, source?: string): void {
  currentRoot = path.resolve(dir);
  currentSource = source ?? null;
}

/** 当前进程实际生效的上传根目录（未初始化时抛错，绝不静默回落 cwd） */
export function getUploadRoot(): string {
  if (!currentRoot) {
    throw new Error(
      '上传根目录尚未初始化：应由 UploadModule 的 UPLOAD_ROOT provider 在启动时注入（见 src/upload/upload.module.ts）',
    );
  }
  return currentRoot;
}

/**
 * 当前生效的目录 + 来源（`system_configs` / `env` / `default`）。
 *
 * 「当前生效值」必须来自这里（内存值），不能重读配置 —— 否则会与「已保存未重启」
 * 的权威配置值混为一谈（design §1.2 要求页面展示双值，读的就是这一对）。
 */
export function getUploadRootInfo(): { path: string; source: string | null } {
  return { path: getUploadRoot(), source: currentSource };
}

/** 是否已初始化（仅用于诊断/测试，不参与业务） */
export function hasUploadRoot(): boolean {
  return currentRoot !== null;
}

